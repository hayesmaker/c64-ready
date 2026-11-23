// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hayesmaker
// See LICENSE in the project root for full license information.
/**
 * agent-cli.mjs — deterministic "load → run → inspect" runner for LLM agents and scripts.
 *
 * Unlike the streaming headless CLI, everything here is driven by *emulated* frames
 * (one PAL frame ≈ 20 ms per `debugger_update`), never wall-clock time, so the same
 * command produces the same result every run.
 *
 * See `bin/agent.mjs --help` and docs/AGENT_CLI.md.
 */

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { C64WASM } from './c64-wasm.mjs';
import { C64_KEY, pressC64Key, releaseC64Key } from './c64-key-map.mjs';
import { encodePng } from './png.mjs';

export const FRAME_WIDTH = 384;
export const FRAME_HEIGHT = 272;
export const FRAME_MS = 20; // one PAL frame
const BOOT_MAX_FRAMES = 300;
const DRIVE_BOOT_FRAMES = 100; // 2 s for the 1541 to boot after being enabled
const DEFAULT_TAP_FRAMES = 3;
// The core draws its `lvllvl` watermark into the frame for the first 40 calls to
// c64_getPixelBuffer(), then stops for good. The browser player reads the buffer every
// frame, so the watermark shows only for its first ~0.7 s. The agent reads it only for
// screenshots, so without this every screenshot would carry it. Reading past the
// threshold once at start-up makes agent frames match what the player shows.
export const WATERMARK_FRAME_READS = 40;
const KBD_BUF_LEN = 0x00c6;
const KBD_BUF = 0x0277;
const KBD_BUF_MAX = 10;

export const HELP = `c64-agent — run a C64 program headlessly and report what happened.

Usage:
  c64-agent [file.prg|.crt|.d64|.c64] [options]

Time is counted in emulated PAL frames (50 per second), so runs are deterministic.

Run control:
  --frames <n>            Frames to run after loading            [default: 100]
  --no-run                Load a .prg/.d64 but do not type RUN
  --sys <addr>            Start a .prg with SYS <addr> instead of RUN
  --break <addr>          Stop when the PC reaches <addr> (repeatable)
  --until-text <str>      Stop when <str> appears on screen (exit 3 if it never does)
  --poke <addr>=<v>[,v]   Write bytes after loading, before running (repeatable)
  --symbols <file>        KickAssembler .sym or VICE label file. Addresses may then be
                          labels (--break game_loop, --dump score:4) and the report
                          shows the PC as label+offset

Input (scheduled on frame numbers, counted from 0 after load):
  --type <text>           Type text into the keyboard buffer at frame 0 (\\n = RETURN)
  --at <frame>:<action>   Schedule an action (repeatable). Actions:
        type=<text>         queue text into the KERNAL keyboard buffer
        press=<KEY>[+KEY]   hold keys for ${DEFAULT_TAP_FRAMES} frames (matrix scan — works in games)
        hold=<KEY>[+KEY]    press and keep held       release=<KEY>[+KEY]  let go
        joy1=<dirs>|joy2=<dirs>  set joystick state, e.g. joy2=up+fire, joy2=none
        screenshot=<path>   save a PNG at this frame
        poke=<addr>=<v>[,v] write memory at this frame

Output:
  --screenshot <path>     PNG of the final frame
  --every <n> --shots-dir <dir>   PNG every n frames (frame-00050.png …)
  --scale <n>             Integer upscale for PNGs                 [default: 1]
  --video <path>          Record .mp4/.gif/.webm of the run (needs ffmpeg on PATH)
  --screen                Print the text screen (decoded screen RAM)
  --dump <a>-<b>|<a>:<len>  Hex dump of CPU-visible memory (repeatable)
  --vic                   Print VIC-II registers $D000-$D02E
  --no-regs               Omit CPU registers from the report
  --save-snapshot <path>  Save a native .c64 snapshot at the end
  --json                  Print the report as JSON
  --wasm <path>           Path to c64.wasm                [default: bundled]
  --help                  Show this help

Addresses are hex ($c000, 0xc000, c000), #49152 for decimal, or a label with --symbols.
Quote "$…" in shells.
Key names: A-Z, 0-9, SPACE, RETURN, F1 F3 F5 F7, RUN_STOP, SHIFT_LEFT, CTRL, COMMODORE,
  CURSOR_UP_DOWN, CURSOR_LEFT_RIGHT, CLEAR_HOME, INS_DEL, RESTORE (NMI pulse), … (see C64_KEY).

Exit codes: 0 ok · 1 error · 3 --until-text not reached.

Examples:
  c64-agent game.prg --frames 250 --screenshot shot.png --screen
  c64-agent game.prg --at 100:joy2=right+fire --at 150:joy2=none --frames 200 --json
  c64-agent test.prg --until-text "PASS" --frames 3000 --dump '$c000:32'
`;

// ── parsing helpers ──────────────────────────────────────────────────────────

/**
 * Parse a symbol file into Map<name, address>.
 * Supports KickAssembler .sym (`.label name=$0810`, `.const`, `.namespace x { … }`),
 * VICE label files (`al C:0810 .name`) and plain `name = $0810` lines.
 */
export function parseSymbols(text) {
  const syms = new Map();
  const ns = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const nsOpen = line.match(/^\.namespace\s+([\w@]+)\s*\{/);
    if (nsOpen) {
      ns.push(nsOpen[1]);
      continue;
    }
    if (line === '}') {
      ns.pop();
      continue;
    }
    let m = line.match(/^al\s+(?:C:)?([0-9a-f]+)\s+\.?([\w@.]+)/i);
    if (m) {
      syms.set(m[2], Number.parseInt(m[1], 16));
      continue;
    }
    m = line.match(/^(?:\.(?:label|const|var)\s+)?([A-Za-z_@][\w@.]*)\s*=\s*\$([0-9a-f]+)\b/i);
    if (m) {
      const v = Number.parseInt(m[2], 16);
      if (v > 0xffff) continue;
      const name = ns.length ? `${ns.join('.')}.${m[1]}` : m[1];
      syms.set(name, v);
      if (ns.length && !syms.has(m[1])) syms.set(m[1], v);
    }
  }
  return syms;
}

/** "label" or "label+n" for the nearest symbol at or below addr (within 256 bytes). */
export function nearestSymbol(syms, addr) {
  if (!syms || !syms.size) return null;
  let best = null;
  let bestAddr = -1;
  for (const [name, a] of syms) {
    if (a <= addr && a > bestAddr && addr - a < 256) {
      best = name;
      bestAddr = a;
    }
  }
  if (best === null) return null;
  return addr === bestAddr ? best : `${best}+${addr - bestAddr}`;
}

/** Parse an address: $hex, 0xhex, bare hex, #decimal, or a label (`name`, `name+3`). */
export function parseAddr(str, symbols = null) {
  const s = String(str).trim();
  if (symbols) {
    const sym = s.match(/^([A-Za-z_@][\w@.]*)(?:\+(\d+))?$/);
    if (sym && symbols.has(sym[1])) return (symbols.get(sym[1]) + Number(sym[2] ?? 0)) & 0xffff;
  }
  let n;
  if (s.startsWith('#')) n = Number.parseInt(s.slice(1), 10);
  else if (s.startsWith('$')) n = Number.parseInt(s.slice(1), 16);
  else if (/^0x/i.test(s)) n = Number.parseInt(s.slice(2), 16);
  else n = Number.parseInt(s, 16);
  if (!/^(#\d+|\$[0-9a-f]+|0x[0-9a-f]+|[0-9a-f]+)$/i.test(s) || !Number.isFinite(n)) {
    throw new Error(`Invalid address${symbols ? ' or unknown symbol' : ''}: ${str}`);
  }
  if (n < 0 || n > 0xffff) throw new Error(`Address out of range: ${str}`);
  return n;
}

function parseByte(str) {
  const v = parseAddr(str);
  if (v > 0xff) throw new Error(`Byte out of range: ${str}`);
  return v;
}

/** Parse `a-b` (inclusive), `a:len` (len decimal unless $/0x) or `a` (256 bytes). */
export function parseRange(str, symbols = null) {
  const s = String(str);
  if (s.includes(':')) {
    const [a, len] = s.split(':');
    const start = parseAddr(a, symbols);
    const n = parseAddr(len.startsWith('$') || /^0x/i.test(len) ? len : `#${len}`);
    if (n < 1) throw new Error(`Invalid length: ${str}`);
    return { start, end: Math.min(0xffff, start + n - 1) };
  }
  if (s.includes('-')) {
    const [a, b] = s.split('-');
    const start = parseAddr(a, symbols);
    const end = parseAddr(b, symbols);
    if (end < start) throw new Error(`Invalid range: ${str}`);
    return { start, end };
  }
  const start = parseAddr(s, symbols);
  return { start, end: Math.min(0xffff, start + 255) };
}

export function parsePoke(str, symbols = null) {
  const eq = String(str).indexOf('=');
  if (eq < 0) throw new Error(`Invalid poke (expected addr=value): ${str}`);
  const addr = parseAddr(str.slice(0, eq), symbols);
  const values = str
    .slice(eq + 1)
    .split(',')
    .map((v) => parseByte(v));
  return { addr, values };
}

const KEY_ALIASES = {
  ENTER: 'RETURN',
  RET: 'RETURN',
  SHIFT: 'SHIFT_LEFT',
  LSHIFT: 'SHIFT_LEFT',
  RSHIFT: 'SHIFT_RIGHT',
  RUNSTOP: 'RUN_STOP',
  STOP: 'RUN_STOP',
  CBM: 'COMMODORE',
  C64: 'COMMODORE',
  HOME: 'CLEAR_HOME',
  DEL: 'INS_DEL',
  DOWN: 'CURSOR_UP_DOWN',
  RIGHT: 'CURSOR_LEFT_RIGHT',
};
const DIGIT_NAMES = [
  'ZERO',
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
];

export function parseKeyName(name) {
  let k = String(name).trim().toUpperCase();
  if (/^[0-9]$/.test(k)) k = DIGIT_NAMES[Number(k)];
  k = KEY_ALIASES[k] ?? k;
  if (!(k in C64_KEY)) throw new Error(`Unknown C64 key: ${name}`);
  return C64_KEY[k];
}

const JOY_BITS = { up: 0x01, down: 0x02, left: 0x04, right: 0x08, fire: 0x10 };

export function parseJoy(str) {
  const s = String(str).trim().toLowerCase();
  if (s === '' || s === 'none' || s === '0') return 0;
  let bits = 0;
  for (const part of s.split('+')) {
    if (!(part in JOY_BITS)) throw new Error(`Unknown joystick input: ${part}`);
    bits |= JOY_BITS[part];
  }
  return bits;
}

/** Convert user text to PETSCII bytes for the keyboard buffer. `\n` (real or escaped) → RETURN. */
export function textToPetscii(text) {
  const norm = String(text).replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').toUpperCase();
  const out = [];
  for (const ch of norm) {
    const c = ch.charCodeAt(0);
    if (ch === '\n') out.push(13);
    else if (c >= 0x20 && c < 0x60) out.push(c);
    else throw new Error(`Cannot type character ${JSON.stringify(ch)} via the keyboard buffer`);
  }
  return out;
}

export function parseAction(spec, symbols = null) {
  const s = String(spec);
  const colon = s.indexOf(':');
  if (colon < 0) throw new Error(`Invalid --at (expected frame:action): ${spec}`);
  const frame = Number(s.slice(0, colon));
  if (!Number.isInteger(frame) || frame < 0) throw new Error(`Invalid frame in --at: ${spec}`);
  const body = s.slice(colon + 1);
  const eq = body.indexOf('=');
  if (eq < 0) throw new Error(`Invalid action (expected name=value): ${body}`);
  const name = body.slice(0, eq).trim().toLowerCase();
  const value = body.slice(eq + 1);
  switch (name) {
    case 'type':
      return { frame, kind: 'type', bytes: textToPetscii(value) };
    case 'press':
    case 'hold':
    case 'release':
      return { frame, kind: name, keys: value.split('+').map(parseKeyName) };
    case 'joy1':
    case 'joy2':
      return { frame, kind: 'joy', port: name === 'joy1' ? 1 : 2, bits: parseJoy(value) };
    case 'screenshot':
      return { frame, kind: 'screenshot', path: value };
    case 'poke':
      return { frame, kind: 'poke', ...parsePoke(value, symbols) };
    default:
      throw new Error(`Unknown action: ${name}`);
  }
}

/** @param {string[]} argv  @param {(p: string) => string} [readText] */
export function parseArgs(argv, readText = (p) => readFileSync(p, 'utf8')) {
  // Load symbols first so every address argument can name a label, wherever it appears.
  const symIdx = argv.indexOf('--symbols');
  let symbols = null;
  if (symIdx >= 0) {
    if (symIdx + 1 >= argv.length) throw new Error('--symbols needs a value');
    symbols = parseSymbols(readText(argv[symIdx + 1]));
  }
  const o = {
    symbols,
    file: null,
    wasm: null,
    frames: 100,
    run: true,
    sys: null,
    breaks: [],
    untilText: null,
    pokes: [],
    actions: [],
    screenshot: null,
    every: 0,
    shotsDir: null,
    scale: 1,
    video: null,
    screen: false,
    dumps: [],
    vic: false,
    regs: true,
    saveSnapshot: null,
    json: false,
    help: false,
  };
  const need = (i, flag) => {
    if (i >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        o.help = true;
        break;
      case '--wasm':
        o.wasm = need(++i, a);
        break;
      case '--symbols':
        i++; // already loaded above
        break;
      case '--frames':
      case '-n':
        o.frames = Number(need(++i, a));
        if (!Number.isInteger(o.frames) || o.frames < 0) throw new Error('--frames must be >= 0');
        break;
      case '--no-run':
        o.run = false;
        break;
      case '--sys':
        o.sys = parseAddr(need(++i, a), symbols);
        break;
      case '--break':
        o.breaks.push(parseAddr(need(++i, a), symbols));
        break;
      case '--until-text':
        o.untilText = need(++i, a).toUpperCase();
        break;
      case '--poke':
        o.pokes.push(parsePoke(need(++i, a), symbols));
        break;
      case '--type':
        o.actions.push({ frame: 0, kind: 'type', bytes: textToPetscii(need(++i, a)) });
        break;
      case '--at':
        o.actions.push(parseAction(need(++i, a), symbols));
        break;
      case '--screenshot':
        o.screenshot = need(++i, a);
        break;
      case '--every':
        o.every = Number(need(++i, a));
        break;
      case '--shots-dir':
        o.shotsDir = need(++i, a);
        break;
      case '--scale':
        o.scale = Number(need(++i, a));
        break;
      case '--video':
        o.video = need(++i, a);
        break;
      case '--screen':
        o.screen = true;
        break;
      case '--dump':
        o.dumps.push(parseRange(need(++i, a), symbols));
        break;
      case '--vic':
        o.vic = true;
        break;
      case '--no-regs':
        o.regs = false;
        break;
      case '--save-snapshot':
        o.saveSnapshot = need(++i, a);
        break;
      case '--json':
        o.json = true;
        break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
        if (o.file) throw new Error(`Unexpected extra argument: ${a}`);
        o.file = a;
    }
  }
  if (o.every && !o.shotsDir) o.shotsDir = '.';
  return o;
}

export function inferType(file) {
  const l = file.toLowerCase();
  if (l.endsWith('.prg')) return 'prg';
  if (l.endsWith('.crt')) return 'crt';
  if (l.endsWith('.d64')) return 'd64';
  if (l.endsWith('.c64') || l.endsWith('.snapshot') || l.endsWith('.s64')) return 'snapshot';
  throw new Error(`Unsupported file type: ${file} (expected .prg, .crt, .d64 or .c64)`);
}

// ── inspection helpers ───────────────────────────────────────────────────────

/** Screen code → printable char. Graphics glyphs become '#'. */
export function screenCodeToChar(code, lowercase) {
  const c = code & 0x7f;
  if (c === 0) return '@';
  if (c < 27) return String.fromCharCode((lowercase ? 96 : 64) + c);
  if (c < 32) return '[£]↑←'[c - 27];
  if (c < 64) return String.fromCharCode(c);
  if (lowercase && c >= 65 && c <= 90) return String.fromCharCode(c);
  if (c === 96) return ' ';
  return '#';
}

export function readScreenInfo(x) {
  const d011 = x.c64_vicReadRegister(0x11);
  const d016 = x.c64_vicReadRegister(0x16);
  const d018 = x.c64_vicReadRegister(0x18);
  const bank = 3 - (x.c64_cpuReadNS(0xdd00) & 3);
  const screenBase = bank * 0x4000 + ((d018 >> 4) & 0x0f) * 0x400;
  const bitmap = (d011 & 0x20) !== 0;
  const mode =
    (bitmap ? 'bitmap' : (d011 & 0x40) !== 0 ? 'ecm-text' : 'text') +
    ((d016 & 0x10) !== 0 ? '-multicolor' : '');
  return { screenBase, bank, mode, lowercase: (d018 & 0x02) !== 0, displayOn: (d011 & 0x10) !== 0 };
}

export function readScreenText(x, info = readScreenInfo(x)) {
  const lines = [];
  for (let r = 0; r < 25; r++) {
    let line = '';
    for (let c = 0; c < 40; c++) {
      line += screenCodeToChar(x.c64_ramRead(info.screenBase + r * 40 + c), info.lowercase);
    }
    lines.push(line.trimEnd());
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

export function readRegs(x) {
  const flags = {
    N: x.c64_getFlagN(),
    V: x.c64_getFlagV(),
    B: x.c64_getFlagB(),
    D: x.c64_getFlagD(),
    I: x.c64_getFlagI(),
    Z: x.c64_getFlagZ(),
    C: x.c64_getFlagC(),
  };
  const p =
    (flags.N ? 0x80 : 0) |
    (flags.V ? 0x40 : 0) |
    0x20 |
    (flags.B ? 0x10 : 0) |
    (flags.D ? 0x08 : 0) |
    (flags.I ? 0x04 : 0) |
    (flags.Z ? 0x02 : 0) |
    (flags.C ? 0x01 : 0);
  const flagStr = Object.entries(flags)
    .map(([k, v]) => (v ? k : k.toLowerCase()))
    .join('');
  return {
    pc: x.c64_getPC() & 0xffff,
    a: x.c64_getRegA() & 0xff,
    x: x.c64_getRegX() & 0xff,
    y: x.c64_getRegY() & 0xff,
    sp: x.c64_getSP() & 0xff,
    p,
    flags: flagStr,
    rasterY: x.c64_getRasterY(),
  };
}

const hex = (n, w = 2) => n.toString(16).padStart(w, '0');

export function hexDump(x, start, end) {
  const lines = [];
  const bytes = [];
  for (let a = start; a <= end; a += 16) {
    const row = [];
    for (let b = a; b <= Math.min(end, a + 15); b++) row.push(x.c64_cpuReadNS(b) & 0xff);
    bytes.push(...row);
    const ascii = row.map((v) => (v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.')).join('');
    lines.push(
      `${hex(a, 4)}: ${row
        .map((v) => hex(v))
        .join(' ')
        .padEnd(47)}  ${ascii}`,
    );
  }
  return { start, end, bytes, text: lines.join('\n') };
}

export function readVic(x) {
  const regs = [];
  for (let r = 0; r <= 0x2e; r++) regs.push(x.c64_vicReadRegister(r) & 0xff);
  return regs;
}

// ── runner ───────────────────────────────────────────────────────────────────

async function loadWasm(wasmPath) {
  const bin = await fs.readFile(wasmPath);
  const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const w = new C64WASM();
  await w.instantiate(ab);
  const x = w.exports;
  x.c64_init();
  for (let i = 0; i < WATERMARK_FRAME_READS; i++) x.c64_getPixelBuffer();
  x.sid_setSampleRate(44100);
  x.debugger_set_speed(100);
  x.debugger_play();
  return w;
}

function startVideo(file) {
  const ext = path.extname(file).toLowerCase();
  const codec =
    ext === '.gif'
      ? ['-vf', 'fps=25,split[a][b];[a]palettegen[p];[b][p]paletteuse']
      : ext === '.webm'
        ? ['-c:v', 'libvpx-vp9', '-b:v', '1M']
        : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast'];
  const args = [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${FRAME_WIDTH}x${FRAME_HEIGHT}`,
    '-framerate',
    String(1000 / FRAME_MS),
    '-i',
    '-',
    ...codec,
    file,
  ];
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    proc.on('error', (e) =>
      reject(new Error(`ffmpeg failed to start (is it on PATH?): ${e.message}`)),
    );
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });
  return {
    async write(buf) {
      if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once('drain', r));
    },
    async close() {
      proc.stdin.end();
      await done;
    },
  };
}

/**
 * Run the agent CLI.
 * @param {{ argv?: string[], log?: (msg: string) => void }} options
 * @returns {Promise<{ exitCode: number, report?: object, output: string }>}
 */
export async function runAgent(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const log = options.log ?? ((m) => process.stderr.write(`[c64-agent] ${m}\n`));

  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    return { exitCode: 1, output: `c64-agent: error: ${e.message} (see --help)` };
  }
  if (o.help) return { exitCode: 0, output: HELP };

  const wasmPath = path.resolve(
    o.wasm ?? new URL('../../public/c64.wasm', import.meta.url).pathname,
  );
  const w = await loadWasm(wasmPath);
  const x = w.exports;
  const warnings = [];
  const shots = [];

  const grabFrame = () => {
    const ptr = x.c64_getPixelBuffer();
    w.updateHeapViews();
    return w.heap.heapU8.subarray(ptr, ptr + FRAME_WIDTH * FRAME_HEIGHT * 4);
  };
  const saveShot = async (file) => {
    const abs = path.resolve(file);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, encodePng(grabFrame(), FRAME_WIDTH, FRAME_HEIGHT, { scale: o.scale }));
    shots.push(abs);
  };
  const step = () => x.debugger_update(FRAME_MS);

  // Boot to the READY prompt (c64_init fast-boots; this is a safety net).
  const bootToReady = () => {
    for (let f = 0; f < BOOT_MAX_FRAMES; f++) {
      if (readScreenText(x).includes('READY.')) return;
      step();
    }
    warnings.push('BASIC READY prompt not detected after boot');
  };

  // ── load ──
  const typeQueue = [];
  let type = null;
  let loadAddress = null;
  if (o.file) {
    type = inferType(o.file);
    const data = new Uint8Array(await fs.readFile(o.file));
    if (type === 'prg' || type === 'd64') bootToReady();
    const ptr = w.allocAndWrite(data);
    if (type === 'prg') {
      if (data.length < 3) throw new Error('PRG file too short');
      loadAddress = data[0] | (data[1] << 8);
      x.c64_loadPRG(ptr, data.length, 1);
      if (o.run) {
        if (o.sys !== null) typeQueue.push(...textToPetscii(`SYS${o.sys}\n`));
        else if (loadAddress === 0x0801) typeQueue.push(...textToPetscii('RUN\n'));
        else {
          warnings.push(
            `PRG loads at $${hex(loadAddress, 4)}, not $0801 — not auto-started. Use --sys <addr>.`,
          );
        }
      }
    } else if (type === 'crt') {
      x.c64_loadCartridge(ptr, data.length);
    } else if (type === 'd64') {
      x.c64_setDriveEnabled(1);
      x.c64_insertDisk(ptr, data.length);
      // The emulated 1541 must finish its own ROM boot before it answers on the
      // serial bus; a LOAD sent earlier hangs at "SEARCHING FOR *".
      for (let f = 0; f < DRIVE_BOOT_FRAMES; f++) step();
      typeQueue.push(...textToPetscii(o.run ? 'LOAD"*",8,1\nRUN\n' : 'LOAD"*",8,1\n'));
    } else if (type === 'snapshot') {
      x.c64_reset();
      x.c64_loadSnapshot(ptr, data.length);
    }
    log(
      `loaded ${path.basename(o.file)} (${type}${loadAddress !== null ? ` @ $${hex(loadAddress, 4)}` : ''})`,
    );
  } else {
    bootToReady();
  }

  for (const p of o.pokes) p.values.forEach((v, i) => x.c64_cpuWrite(p.addr + i, v));
  for (const b of o.breaks) x.breakpoints_pcAdd(b);

  // ── schedule ──
  const schedule = new Map();
  for (const act of o.actions) {
    if (!schedule.has(act.frame)) schedule.set(act.frame, []);
    schedule.get(act.frame).push(act);
    if (act.frame >= o.frames)
      warnings.push(`--at frame ${act.frame} is beyond --frames ${o.frames}`);
  }
  const joyState = { 1: 0, 2: 0 };
  const setJoy = (port, bits) => {
    const p = port - 1;
    if (joyState[port]) x.c64_joystick_release(p, joyState[port]);
    if (bits) x.c64_joystick_push(p, bits);
    joyState[port] = bits;
  };
  const releases = new Map(); // frame → keys[]

  const video = o.video ? startVideo(path.resolve(o.video)) : null;

  let frame = 0;
  let stopReason = 'frames';
  try {
    for (; frame < o.frames; frame++) {
      for (const act of schedule.get(frame) ?? []) {
        if (act.kind === 'type') typeQueue.push(...act.bytes);
        else if (act.kind === 'press' || act.kind === 'hold') {
          act.keys.forEach((k) => pressC64Key(x, k));
          if (act.kind === 'press') {
            const at = frame + DEFAULT_TAP_FRAMES;
            releases.set(at, [...(releases.get(at) ?? []), ...act.keys]);
          }
        } else if (act.kind === 'release') act.keys.forEach((k) => releaseC64Key(x, k));
        else if (act.kind === 'joy') setJoy(act.port, act.bits);
        else if (act.kind === 'poke') act.values.forEach((v, i) => x.c64_cpuWrite(act.addr + i, v));
        else if (act.kind === 'screenshot') await saveShot(act.path);
      }
      for (const k of releases.get(frame) ?? []) releaseC64Key(x, k);
      releases.delete(frame);

      // Feed the KERNAL keyboard buffer whenever it has drained.
      if (typeQueue.length && x.c64_cpuReadNS(KBD_BUF_LEN) === 0) {
        const chunk = typeQueue.splice(0, KBD_BUF_MAX);
        chunk.forEach((v, i) => x.c64_cpuWrite(KBD_BUF + i, v));
        x.c64_cpuWrite(KBD_BUF_LEN, chunk.length);
      }

      step();

      if (video) await video.write(grabFrame());
      if (o.every > 0 && (frame + 1) % o.every === 0) {
        await saveShot(path.join(o.shotsDir, `frame-${String(frame + 1).padStart(5, '0')}.png`));
      }
      if (!x.debugger_isRunning()) {
        const pc = x.c64_getPC() & 0xffff;
        stopReason = o.breaks.includes(pc) ? 'breakpoint' : 'paused';
        frame++;
        break;
      }
      if (o.untilText && readScreenText(x).includes(o.untilText)) {
        stopReason = 'until-text';
        frame++;
        break;
      }
    }
  } finally {
    if (video) await video.close();
  }
  if (o.untilText && stopReason === 'frames') stopReason = 'until-text-timeout';
  if (typeQueue.length)
    warnings.push(
      `${typeQueue.length} typed chars never consumed (program not reading keyboard buffer?)`,
    );

  // ── report ──
  if (o.screenshot) await saveShot(o.screenshot);
  if (o.saveSnapshot) {
    const ptr = x.c64_getSnapshot();
    const size = x.c64_getSnapshotSize();
    w.updateHeapViews();
    await fs.writeFile(path.resolve(o.saveSnapshot), w.heap.heapU8.slice(ptr, ptr + size));
  }
  const screenInfo = readScreenInfo(x);
  const regs = o.regs ? readRegs(x) : undefined;
  if (regs && o.symbols) regs.pcLabel = nearestSymbol(o.symbols, regs.pc);
  const report = {
    file: o.file ? path.resolve(o.file) : null,
    type,
    loadAddress,
    framesRun: frame,
    seconds: +((frame * FRAME_MS) / 1000).toFixed(2),
    stopReason,
    regs,
    video: o.video ? path.resolve(o.video) : undefined,
    screenshots: shots,
    screenMode: screenInfo,
    screen: o.screen || o.untilText ? readScreenText(x, screenInfo) : undefined,
    dumps: o.dumps.length ? o.dumps.map((d) => hexDump(x, d.start, d.end)) : undefined,
    vic: o.vic ? readVic(x) : undefined,
    snapshot: o.saveSnapshot ? path.resolve(o.saveSnapshot) : undefined,
    warnings,
  };

  const exitCode = stopReason === 'until-text-timeout' ? 3 : 0;
  return { exitCode, report, output: o.json ? jsonReport(report) : textReport(report) };
}

function jsonReport(r) {
  const copy = { ...r };
  if (copy.dumps) copy.dumps = copy.dumps.map(({ start, end, bytes }) => ({ start, end, bytes }));
  return JSON.stringify(copy, null, 2);
}

export function textReport(r) {
  const out = [];
  out.push(
    `stop: ${r.stopReason} after ${r.framesRun} frames (${r.seconds}s)` +
      (r.file
        ? ` · ${path.basename(r.file)} [${r.type}${r.loadAddress !== null ? ` $${hex(r.loadAddress, 4)}` : ''}]`
        : ''),
  );
  if (r.regs) {
    const g = r.regs;
    out.push(
      `regs: PC=$${hex(g.pc, 4)}${g.pcLabel ? ` (${g.pcLabel})` : ''} A=$${hex(g.a)} X=$${hex(g.x)} Y=$${hex(g.y)} SP=$${hex(g.sp)} P=${g.flags} raster=${g.rasterY}`,
    );
  }
  const m = r.screenMode;
  out.push(
    `video: ${m.mode}, screen $${hex(m.screenBase, 4)} (bank ${m.bank})${m.lowercase ? ', lowercase charset' : ''}${m.displayOn ? '' : ', DISPLAY OFF'}`,
  );
  if (r.screenshots.length) out.push(`screenshots: ${r.screenshots.join(', ')}`);
  if (r.video) out.push(`video file: ${r.video}`);
  if (r.snapshot) out.push(`snapshot: ${r.snapshot}`);
  if (r.screen !== undefined) {
    out.push('screen:');
    out.push('┌' + '─'.repeat(40) + '┐');
    for (const line of r.screen.split('\n')) out.push('│' + line.padEnd(40) + '│');
    out.push('└' + '─'.repeat(40) + '┘');
  }
  if (r.dumps)
    for (const d of r.dumps) out.push(`dump $${hex(d.start, 4)}-$${hex(d.end, 4)}:\n${d.text}`);
  if (r.vic) {
    const v = r.vic;
    out.push('vic:');
    for (let i = 0; i < v.length; i += 16) {
      out.push(
        `  d0${hex(i)}: ${v
          .slice(i, i + 16)
          .map((b) => hex(b))
          .join(' ')}`,
      );
    }
  }
  for (const w of r.warnings) out.push(`warning: ${w}`);
  return out.join('\n');
}
