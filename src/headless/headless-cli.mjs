import fs from 'fs/promises';
import { readFileSync, mkdirSync, createWriteStream, readdirSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import FFmpegRunner from './ffmpeg-runner.mjs';
import { domKeyToC64Actions } from './c64-key-map.mjs';

const nowMonoMs = () => {
  if (
    typeof globalThis.performance !== 'undefined' &&
    typeof globalThis.performance.now === 'function'
  ) {
    return globalThis.performance.now();
  }
  return Date.now();
};

// ── CRT info parser ───────────────────────────────────────────────────────────
// Inline JS port of src/emulator/crt-info.ts — kept here so headless-cli.mjs
// runs without a TypeScript build step.
//
// Reference: https://vice-emu.sourceforge.io/vice_17.html#SEC380
const _CRT_HW_TYPES = {
  0: 'Normal cartridge',
  1: 'Action Replay',
  2: 'KCS Power Cartridge',
  3: 'Final Cartridge III',
  4: 'Simons BASIC',
  5: 'Ocean type 1',
  6: 'Expert Cartridge',
  7: 'Fun Play, Power Play',
  8: 'Super Games',
  9: 'Atomic Power',
  10: 'Epyx Fastload',
  11: 'Westermann Learning',
  12: 'Rex Utility',
  13: 'Final Cartridge I',
  14: 'Magic Formel',
  15: 'C64 Game System (SYSTEM 3)',
  16: 'Warp Speed',
  17: 'Dinamic',
  18: 'Zaxxon / Super Zaxxon (SEGA)',
  19: 'Magic Desk / Domark / HES Australia',
  20: 'Super Snapshot V5',
  21: 'Comal-80',
  22: 'Structured BASIC',
  23: 'Ross',
  24: 'Dela EP64',
  25: 'Dela EP7x8',
  26: 'Dela EP256',
  27: 'Rex EP256',
  28: 'Mikro Assembler',
  29: 'Final Cartridge Plus',
  30: 'Action Replay 4',
  31: 'Stardos',
  32: 'EasyFlash',
  33: 'EasyFlash Xbank',
  34: 'Capture',
  35: 'Action Replay 3',
  36: 'Retro Replay',
  37: 'MMC64',
  38: 'MMC Replay',
  39: 'IDE64',
  40: 'Super Snapshot V4',
  41: 'IEEE-488',
  42: 'Game Killer',
  43: 'Prophet64',
  44: 'EXOS',
  45: 'Freeze Frame',
  46: 'Freeze Machine',
  47: 'Snapshot64',
  48: 'Super Explode V5.0',
  49: 'Magic Voice',
  50: 'Action Replay 2',
  51: 'MACH 5',
  52: 'Diashow-Maker',
  53: 'Pagefox',
  54: 'Kingsoft',
  55: 'Silverrock 128K Longshot',
  56: 'Formel 64',
  57: 'RGCD',
  58: 'RR-Net MK3',
  59: 'Easy Calc',
  60: 'GMod2',
  61: 'MAX Basic',
  62: 'GMod3',
  63: 'ZIPP-CODE 48',
  64: 'Blackbox V8',
  65: 'Blackbox V3',
  66: 'Blackbox V4',
  67: 'REX RAM-Floppy',
  68: 'BIS-Plus',
  69: 'SD-BOX',
  70: 'MultiMAX',
  71: 'Blackbox V9',
  72: 'Lt. Kernal Host Adaptor',
  73: 'RAMLink',
  74: 'H.E.R.O.',
  75: 'IEEE Flash! 64',
  76: 'Turtle Graphics II',
  77: 'Freeze Frame MK2',
  78: 'Partner 64',
};
/**
 * Parse a CRT file and return a human-readable summary line plus metadata.
 * Returns null if the data is too short or the magic bytes are absent.
 * @param {Uint8Array} data
 * @param {string} [filename]
 */
function parseCrtInfo(data, filename) {
  if (!data || data.length < 0x40) return null;
  // Validate "C64 CARTRIDGE" magic
  let magic = '';
  for (let i = 0; i < 16; i++) magic += String.fromCharCode(data[i]);
  if (!magic.startsWith('C64 CARTRIDGE')) return null;

  const headerLen =
    ((data[0x10] << 24) | (data[0x11] << 16) | (data[0x12] << 8) | data[0x13]) >>> 0;
  const hwType = ((data[0x16] << 8) | data[0x17]) >>> 0;
  const exrom = data[0x18];
  const game = data[0x19];

  let cartName = '';
  for (let i = 0x20; i < 0x40 && data[i] !== 0; i++) cartName += String.fromCharCode(data[i]);
  cartName = cartName.trim();

  let bankConfig;
  if (exrom === 0 && game === 0) bankConfig = '16K (ROML+ROMH)';
  else if (exrom === 0 && game === 1) bankConfig = '8K (ROML only)';
  else if (exrom === 1 && game === 0) bankConfig = 'Ultimax';
  else bankConfig = 'inactive (pass-through)';

  let chipCount = 0,
    totalRomBytes = 0;
  let offset = Math.max(headerLen, 0x40);
  while (offset + 16 <= data.length) {
    let cm = '';
    for (let i = 0; i < 4; i++) cm += String.fromCharCode(data[offset + i]);
    if (cm !== 'CHIP') break;
    const pktLen =
      ((data[offset + 4] << 24) |
        (data[offset + 5] << 16) |
        (data[offset + 6] << 8) |
        data[offset + 7]) >>>
      0;
    if (pktLen < 16) break;
    const dataSize = ((data[offset + 0x0e] << 8) | data[offset + 0x0f]) >>> 0;
    chipCount++;
    totalRomBytes += dataSize;
    offset += pktLen;
  }

  const hwName = _CRT_HW_TYPES[hwType] ?? `Unknown(${hwType})`;
  const fileLabel = filename ? ` "${filename}"` : '';
  const namePart = cartName ? ` name="${cartName}"` : '';
  const kbActual = (totalRomBytes / 1024).toFixed(0);
  const line =
    `[C64 cart]${fileLabel} loading: hwType=${hwType}(${hwName})` +
    ` | ${bankConfig} flags, ${kbActual}K actual` +
    ` | ${chipCount} CHIP(s) | ${data.length} bytes${namePart}`;
  return { line, hwType, hwName, exrom, game, bankConfig, cartName, chipCount, totalRomBytes };
}

function getUnsupportedCrtReason(info) {
  if (info && info.exrom === 1 && info.game === 0 && info.hwType === 0) {
    return 'Unsupported CRT: Ultimax/MAX cartridges are not supported by this emulator.';
  }
  return null;
}

function inferLoadType(filename = '') {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith('.crt')) return 'crt';
  if (lower.endsWith('.prg')) return 'prg';
  if (lower.endsWith('.d64')) return 'd64';
  if (lower.endsWith('.snapshot') || lower.endsWith('.c64') || lower.endsWith('.s64'))
    return 'snapshot';
  return 'crt';
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeCommandText(exports, text, opts = {}) {
  if (!exports) return;
  const settleMs = Number.isFinite(opts.settleMs) ? opts.settleMs : 120;
  const keyDelayMs = Number.isFinite(opts.keyDelayMs) ? opts.keyDelayMs : 22;

  if (settleMs > 0) await sleepMs(settleMs);

  for (const ch of text) {
    const key = ch === '\n' ? 'Enter' : ch;
    const down = domKeyToC64Actions(key, false, 'keydown');
    for (const act of down) {
      if (act.action === 'press') exports.keyboard_keyPressed(act.key);
      else exports.keyboard_keyReleased(act.key);
    }
    if (typeof exports.debugger_update === 'function') exports.debugger_update(12);
    if (keyDelayMs > 0) await sleepMs(keyDelayMs);

    const up = domKeyToC64Actions(key, false, 'keyup');
    for (const act of up) {
      if (act.action === 'press') exports.keyboard_keyPressed(act.key);
      else exports.keyboard_keyReleased(act.key);
    }
    if (typeof exports.debugger_update === 'function') exports.debugger_update(12);
    if (keyDelayMs > 0) await sleepMs(keyDelayMs);
  }
}

// ── Build info ────────────────────────────────────────────────────────────────
// Read once at module load so every createInputServer call gets the same values.
const _repoRootForBuildInfo = path.resolve(new URL('../../', import.meta.url).pathname);
let _serverVersion = null;
let _serverGitHash = null;
try {
  const pkg = JSON.parse(readFileSync(path.join(_repoRootForBuildInfo, 'package.json'), 'utf8'));
  _serverVersion = pkg.version ?? null;
} catch {
  /* non-fatal */
}
try {
  // Prefer the baked-in build-arg written by the Dockerfile (works in Docker
  // where git is not installed and .git is not present).
  // Fall back to execSync for local dev where the repo is available.
  const hashFile = path.join(_repoRootForBuildInfo, '.git-hash');
  if (process.env.GIT_HASH) {
    _serverGitHash = process.env.GIT_HASH.trim() || null;
  } else {
    try {
      _serverGitHash = readFileSync(hashFile, 'utf8').trim() || null;
    } catch {
      _serverGitHash = execSync('git rev-parse --short HEAD', {
        cwd: _repoRootForBuildInfo,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    }
  }
} catch {
  /* non-fatal — git may not be available in some deploy environments */
}

/**
 * Run headless emulator. Exported so tests can inject a fake WebAssembly.instantiate.
 * options: { argv?: string[], instantiateFn?: (wasmBinary, importObject) => Promise<{ instance }>, repoRoot?: string }
 */
export async function runHeadless(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const repoRoot = options.repoRoot ?? path.resolve(new URL('../../', import.meta.url).pathname);

  // parse args
  let wasmArg = null;
  let gameArg = null;
  let noGame = false;
  let verbose = false;
  let frames = 300;
  let fps = 60;
  let verify = false;
  let record = false;
  let audio = false;
  let raw = false;
  let output = null;
  let durationSec = 0; // 0 means no --duration was passed → stream forever when recording
  let enableInput = false;
  let wsPort = 9001;
  let webrtc = false;
  let webrtcPort = 9002;
  let logEvents = false;
  let maxSpectators = 3;
  let webrtcMinBitrateKbps = 200;
  let webrtcMaxBitrateKbps = 600;
  let webrtcOutputFps = 40;
  let adminToken = process.env.C64_ADMIN_TOKEN ?? '';
  let logFile = false;
  let logRetainDays = 7;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wasm' || a === '-w') wasmArg = argv[++i];
    else if (a === '--game' || a === '-g') gameArg = argv[++i];
    else if (a === '--frames' || a === '-n') frames = Number(argv[++i]);
    else if (a === '--verify') verify = true;
    else if (a === '--record') record = true;
    else if (a === '--audio') audio = true;
    else if (a === '--raw') raw = true;
    else if (a === '--output' || a === '-o') output = argv[++i];
    else if (a === '--duration' || a === '-d') durationSec = Number(argv[++i]);
    else if (a === '--no-game') noGame = true;
    else if (a === '--verbose') verbose = true;
    else if (a === '--log-events') logEvents = true;
    else if (a === '--log-file') logFile = true;
    else if (a === '--log-retain-days') logRetainDays = Number(argv[++i]);
    else if (a === '--fps') fps = Number(argv[++i]);
    else if (a === '--input') enableInput = true;
    else if (a === '--ws-port') wsPort = Number(argv[++i]);
    else if (a === '--webrtc') webrtc = true;
    else if (a === '--webrtc-port') webrtcPort = Number(argv[++i]);
    else if (a === '--max-spectators') maxSpectators = Number(argv[++i]);
    else if (a === '--webrtc-min-bitrate-kbps') webrtcMinBitrateKbps = Number(argv[++i]);
    else if (a === '--webrtc-max-bitrate-kbps') webrtcMaxBitrateKbps = Number(argv[++i]);
    else if (a === '--webrtc-output-fps') webrtcOutputFps = Number(argv[++i]);
    else if (a === '--admin-token') adminToken = argv[++i] ?? '';
    else if (a === '--help' || a === '-h') {
      return { ok: false, output: 'help' };
    }
  }
  const adminTokenSafe = String(adminToken ?? '').trim();

  const webrtcMinBitrateKbpsSafe =
    Number.isFinite(webrtcMinBitrateKbps) && webrtcMinBitrateKbps > 0
      ? Math.round(webrtcMinBitrateKbps)
      : 200;
  const webrtcMaxBitrateKbpsSafe =
    Number.isFinite(webrtcMaxBitrateKbps) && webrtcMaxBitrateKbps > 0
      ? Math.max(webrtcMinBitrateKbpsSafe, Math.round(webrtcMaxBitrateKbps))
      : Math.max(webrtcMinBitrateKbpsSafe, 600);
  const webrtcOutputFpsSafe =
    Number.isFinite(webrtcOutputFps) && webrtcOutputFps > 0 ? Math.round(webrtcOutputFps) : 0;

  const runtimeStats = {
    webrtcSendFps: null,
    videoFramesSent: 0,
    videoFramesDroppedLate: 0,
    videoFramesDroppedCap: 0,
    webrtcPeerCount: null,
    webrtcAvgRttMs: null,
    webrtcSendDelayMsPerPacket: null,
    webrtcEncodeMsPerFrame: null,
    webrtcFramesSentPerSec: null,
    webrtcFramesEncodedPerSec: null,
    webrtcBytesSentPerSec: null,
    webrtcQualityLimitation: null,
    sampledAt: Date.now(),
  };

  // ── Log file setup ────────────────────────────────────────────────────────────
  let logStream = null;
  let _origConsoleLog = null;
  let _origConsoleError = null;

  function _setupLogFile() {
    if (!logFile) return;

    const logsDir = path.join(repoRoot, 'logs');
    try {
      mkdirSync(logsDir, { recursive: true });
    } catch (e) {
      console.error('[headless] could not create logs directory:', e.message);
      return;
    }

    // Clean up old logs
    if (logRetainDays > 0) {
      try {
        const files = readdirSync(logsDir);
        const now = Date.now();
        for (const f of files) {
          if (!f.startsWith('headless-') || !f.endsWith('.log')) continue;
          const fpath = path.join(logsDir, f);
          const stat = statSync(fpath);
          const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
          if (ageDays > logRetainDays) {
            unlinkSync(fpath);
            console.error(`[headless] purged old log: ${f} (${ageDays.toFixed(1)} days old)`);
          }
        }
      } catch (e) {
        console.error('[headless] log cleanup error:', e.message);
      }
    }

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const logPath = path.join(logsDir, `headless-${timestamp}.log`);
    try {
      logStream = createWriteStream(logPath, { flags: 'a' });
      console.error(`[headless] logging to: ${logPath}`);
    } catch (e) {
      console.error('[headless] could not open log file:', e.message);
      return;
    }

    // Tee console methods
    _origConsoleLog = console.log;
    _origConsoleError = console.error;

    const _writeLog = (origFn, ...args) => {
      origFn.apply(console, args);
      if (logStream && logStream.writable) {
        const line =
          args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
        logStream.write(line);
      }
    };

    console.log = (...args) => _writeLog(_origConsoleLog, ...args);
    console.error = (...args) => _writeLog(_origConsoleError, ...args);
  }

  function _teardownLogFile() {
    if (logStream) {
      try {
        logStream.end();
      } catch (_) {}
      logStream = null;
    }
    if (_origConsoleLog) {
      console.log = _origConsoleLog;
      console.error = _origConsoleError;
      _origConsoleLog = null;
      _origConsoleError = null;
    }
  }

  _setupLogFile();

  const defaultWasmPaths = [
    path.join(repoRoot, 'public', 'c64.wasm'),
    path.join(repoRoot, 'src', 'emulator', 'c64.wasm'),
  ];
  const defaultGamePaths = [
    path.join(repoRoot, 'public', 'games', 'cartridges', 'legend-of-wilf.crt'),
  ];

  async function findFirstExisting(paths) {
    for (const p of paths) {
      try {
        await fs.access(p);
        return p;
      } catch (_) {}
    }
    return null;
  }

  let wasmPath = wasmArg;
  if (!wasmPath) {
    const found = await findFirstExisting(defaultWasmPaths);
    if (found) wasmPath = found;
  }
  if (!wasmPath) return { ok: false, err: 'no-wasm' };

  let gamePath = gameArg ?? null;
  // If the user requested no game, ensure we do not load any default cartridge
  // even if one exists on disk.
  if (noGame) {
    gamePath = null;
  } else if (!gamePath) {
    const found = await findFirstExisting(defaultGamePaths);
    if (found) gamePath = found;
  }

  const out = [];
  out.push(
    `Starting headless C64 using WASM: ${wasmPath}` + (gamePath ? ` game: ${gamePath}` : ''),
  );

  const wasmBinary = await fs.readFile(wasmPath);
  // runtime state placeholders — hoisted so onCommand handler can access c64wasm
  let exports = null;
  let heap = null;
  let c64wasm = null; // ← hoisted: needed by onCommand for allocAndWrite
  let C64WASMClass = null;
  let wrapperUsed = false;
  // SID audio constants — hoisted so the SID-cache block and the frame loop
  // both see them regardless of declaration order.
  const SID_BUFFER_SIZE = 4096;

  // If a test injected a fake instantiate function, prefer that path so
  // tests can run without the compiled wrapper. Provide a minimal import
  // object (memory) that the fake instantiate can use.
  const instantiateFn = options.instantiateFn;
  const wasmAb = wasmBinary.buffer.slice(
    wasmBinary.byteOffset,
    wasmBinary.byteOffset + wasmBinary.byteLength,
  );
  if (typeof instantiateFn === 'function') {
    try {
      const mem = new WebAssembly.Memory({ initial: 256 });
      const importObject = { env: { memory: mem }, wasi_snapshot_preview1: {} };
      const res = await instantiateFn(wasmAb, importObject);
      const inst = res && (res.instance ?? res);
      exports = inst.exports ?? inst;
      // ensure exports.memory exists so later code can read/write
      if (exports && !exports.memory) exports.memory = mem;
      if (exports && exports.memory) {
        const buf = exports.memory.buffer;
        heap = {
          heapU8: new Uint8Array(buf),
          heapF32: new Float32Array(buf),
          heapU32: new Uint32Array(buf),
        };
      }
      if (exports && typeof exports.c64_init === 'function') exports.c64_init();
      if (exports && typeof exports.sid_setSampleRate === 'function')
        exports.sid_setSampleRate(44100);
      if (exports && typeof exports.debugger_set_speed === 'function')
        exports.debugger_set_speed(100);
      if (exports && typeof exports.debugger_play === 'function') exports.debugger_play();
      wrapperUsed = true;
    } catch (e) {
      console.error('[headless] instantiateFn failed:', e && e.message ? e.message : e);
    }
  }

  // Prefer the minimal local wrapper shipped under src/headless so the
  // CLI can run without a compiled dist-ts. This keeps the runtime files
  // in the source tree (src/headless) and avoids postinstall scripts.
  try {
    let C64WASM = null;
    try {
      const localMod = await import(new URL('./c64-wasm.mjs', import.meta.url).href);
      C64WASM = localMod.C64WASM ?? localMod.default ?? null;
      if (C64WASM) console.error('[headless] using local C64WASM wrapper (src/headless)');
    } catch (e) {
      // ignore — will try fallback
    }

    if (!C64WASM) {
      // Fallback to compiled dist-ts if present
      try {
        const wasmModuleUrl = new URL('../../dist-ts/emulator/c64-wasm.js', import.meta.url).href;
        const wasmMod = await import(wasmModuleUrl);
        C64WASM = wasmMod.C64WASM ?? wasmMod.default ?? null;
        if (C64WASM) console.error('[headless] using C64WASM from dist-ts');
      } catch (e) {
        // final fallback failure — will be handled below
      }
    }

    if (!C64WASM) throw new Error('C64WASM wrapper not found (src/headless or dist-ts)');
    C64WASMClass = C64WASM;

    const wasmAb = wasmBinary.buffer.slice(
      wasmBinary.byteOffset,
      wasmBinary.byteOffset + wasmBinary.byteLength,
    );
    c64wasm = new C64WASM(); // assigns to outer let
    await c64wasm.instantiate(wasmAb);

    exports = c64wasm.exports;
    heap = c64wasm.heap;

    // Initialise emulator state — mirrors C64Emulator.init() + start()
    exports.c64_init();
    exports.sid_setSampleRate(44100);
    exports.debugger_set_speed(100); // 100 = full speed (1% would be near-frozen)
    exports.debugger_play();

    if (gamePath) {
      try {
        const gameData = await fs.readFile(gamePath);
        const gameArr = new Uint8Array(gameData);
        const cartInfo = parseCrtInfo(gameArr, path.basename(gamePath));
        if (cartInfo) {
          console.error(cartInfo.line);
          const unsupportedReason = getUnsupportedCrtReason(cartInfo);
          if (unsupportedReason) {
            throw new Error(unsupportedReason);
          }
        }
        const ptr = c64wasm.allocAndWrite(gameArr);
        c64wasm.updateHeapViews();
        heap = c64wasm.heap;
        exports.c64_loadCartridge(ptr, gameData.length);
        // free(ptr), c64_reset, debugger_set_speed, debugger_play intentionally
        // omitted: c64_loadCartridge already resets and resumes the machine
        // internally. Calling them re-triggers the ROM boot sequence — the same
        // root cause of post-load input lag fixed for the load-crt command path.
      } catch (e) {
        out.push(`Failed to load game: ${String(e)}`);
      }
    }

    wrapperUsed = true;
  } catch (e) {
    console.error('[headless] C64WASM wrapper failed to load:', e && e.message ? e.message : e);
  }
  if (!wrapperUsed) {
    out.push('ERROR: dist-ts wrapper failed to load — cannot run headless');
    console.error(
      '[headless] FATAL: dist-ts wrapper unavailable. Run: npx tsc -p tsconfig.build2.json',
    );
    return { ok: false, output: out };
  }

  // ── Input server (WebSocket) ──────────────────────────────────────────────
  // Start the embedded WebSocket input server when --input is passed.
  // Remote clients connect and send JSON InputEvent messages which are
  // forwarded directly to the WASM joystick/keyboard exports.
  let inputServer = null;
  if (enableInput) {
    try {
      const { createInputServer } = await import('./input-server.mjs');
      // Try to import the kick-token validator from the co-located c64cade server.
      // If it's not present (standalone c64-ready usage) fall back to no-op.
      // NOTE: The import path is computed at runtime (not a string literal) so
      // Vite/Vitest does NOT attempt to resolve/bundle it at transform time —
      // dynamic import of a non-literal string is left to the JS engine.
      let validateKickToken = () => null;
      try {
        const kickTokenRelPath = '../../c64cade/packages/server/utils/kick-tokens.js';
        const kickTokenUrl = new URL(kickTokenRelPath, import.meta.url).href;
        const kickTokens = await import(kickTokenUrl);
        validateKickToken = kickTokens.validateKickToken;
      } catch {
        /* standalone mode — admin kick not available */
      }

      const dirMap = { up: 0x1, down: 0x2, left: 0x4, right: 0x8 };

      /** Flush all SID ring state after any emulator reset/cart-change.
       *  The WASM SID resets its internal write cursor on c64_reset(), so any
       *  samples still in the JS ring are from the old game and must be discarded.
       *  sidSampleAccum is also zeroed so the next pull aligns with the freshly
       *  restarted SID write cursor rather than inheriting stale offset.
       *  Note: we do NOT call primeSidRing() here — that would run 186ms of
       *  synchronous debugger_update inside the load-crt setImmediate callback
       *  and add unwanted post-load blockage. The ring re-fills naturally within
       *  ~5 frames; those frames output silence which is inaudible during the
       *  game's own startup sound sequence. */
      function resetSidRing() {
        sidSampleAccum = 0;
        sidRingWrite = 0;
        sidRingRead = 0;
        sidRingCount = 0;
        sidFrameBufMax.fill(0);
        sidFrameView = sidFrameBufMax.subarray(0, 1);
      }

      inputServer = createInputServer({
        port: wsPort,
        verbose,
        logEvents,
        validateKickToken,
        validateAdminToken: (token) => {
          if (!adminTokenSafe) return false;
          return token === adminTokenSafe;
        },
        initialCartFilename: gamePath ? path.basename(gamePath) : null,
        serverVersion: _serverVersion,
        serverGitHash: _serverGitHash,
        getRuntimeStats: () => ({ ...runtimeStats }),
        getWebrtcPeerSnapshot: () => getWebrtcPeerSnapshot(),
        disconnectWebrtcPeersByAddr: (addr, reason) => disconnectWebrtcPeersByAddr(addr, reason),
        disconnectAllWebrtcPeers: (reason) => disconnectAllWebrtcPeers(reason),
        onCommand: async (cmd) => {
          if (!exports) return;
          if (cmd.type === 'load-file' || cmd.type === 'load-crt') {
            const requestedType =
              cmd.type === 'load-crt' ? 'crt' : (cmd.fileType ?? inferLoadType(cmd.filename));
            // Decode base64 → Uint8Array immediately and release the large
            // base64 string from the cmd object as soon as possible so GC
            // can reclaim it during the subsequent async gap.
            const buf = Buffer.from(cmd.data, 'base64');
            // Slice to own ArrayBuffer — avoids aliasing Node's pooled Buffer
            // which could span a much larger backing store than the data alone.
            const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
            cmd.data = null; // release base64 string early
            const byteLen = arr.length;
            const filename = cmd.filename;
            // Defer the blocking WASM work (malloc + copy + cartridge parse)
            // via setImmediate so the event loop can drain any pending frame
            // writes / setTimeout callbacks before the synchronous WASM work
            // begins. This prevents the frame loop from stalling mid-write.
            // Return a Promise so input-server waits before broadcasting
            // cart-loaded — ensuring clients are told only after load succeeds.
            return new Promise((resolve, reject) => {
              setImmediate(async () => {
                try {
                  const gapStart = Date.now();
                  const loadType = requestedType;
                  // For cartridge loads, reset first so bank state does not leak.
                  if (loadType === 'crt') {
                    exports.c64_removeCartridge();
                    exports.c64_reset();
                  }
                  const ptr = c64wasm.allocAndWrite(arr);
                  c64wasm.updateHeapViews();
                  heap = c64wasm.heap;
                  try {
                    if (loadType === 'crt') {
                      const cartInfo = parseCrtInfo(arr, filename);
                      if (cartInfo) {
                        console.error(cartInfo.line);
                        const unsupportedReason = getUnsupportedCrtReason(cartInfo);
                        if (unsupportedReason) {
                          throw new Error(unsupportedReason);
                        }
                      }
                      exports.c64_loadCartridge(ptr, byteLen);
                    } else if (loadType === 'prg') {
                      exports.c64_loadPRG(ptr, byteLen, 1);
                      await typeCommandText(exports, 'run\n');
                    } else if (loadType === 'd64') {
                      exports.c64_setDriveEnabled(1);
                      exports.c64_insertDisk(ptr, byteLen);
                    } else if (loadType === 'snapshot') {
                      exports.c64_loadSnapshot(ptr, byteLen);
                    } else {
                      throw new Error(`Unsupported load-file type: ${loadType}`);
                    }
                  } finally {
                    c64wasm.free(ptr);
                  }
                  const gapMs = Date.now() - gapStart;
                  //
                  // ── Audio RTP re-sync after blocking gap ─────────────────────
                  // c64_loadCartridge blocks the event loop for ~1300ms. During
                  // this time the frame loop is frozen so no audio is pushed to
                  // RTCAudioSource. The video RTP clock (driven by @roamhq/wrtc
                  // internally via wall-clock) keeps ticking, but the audio RTP
                  // clock only advances when onData() is called — so audio falls
                  // ~1300ms behind video. The browser's AV sync logic then holds
                  // video playback until audio catches up, manifesting as input lag.
                  //
                  // Fix: push silence frames totalling the measured gap duration so
                  // the audio RTP clock jumps forward by the same amount the video
                  // RTP clock advanced during the blockage.
                  resetSidRing();
                  if (webrtcEncoder) {
                    webrtcEncoder.pushSilenceForGap(gapMs);
                    if (verbose)
                      console.error(
                        `[headless] pushed ${gapMs}ms silence to re-align audio RTP after cart load`,
                      );
                  }
                  if (webrtcServer) webrtcServer.forceKeyframe(webrtcEncoder?.videoTrack);
                  if (verbose)
                    console.error(
                      `[headless] file loaded: ${filename} (${loadType}, ${byteLen} bytes, gap=${gapMs}ms)`,
                    );
                  else if (logEvents)
                    console.error(
                      `[event] cart-loaded filename=${filename} type=${loadType} bytes=${byteLen} gap=${gapMs}ms`,
                    );
                  resolve();
                } catch (err) {
                  if (verbose) console.error('[headless] cart load (deferred) error:', err);
                  else if (logEvents)
                    console.error(
                      `[event] error cart-load-failed filename=${filename} err=${err && err.message ? err.message : err}`,
                    );
                  reject(err);
                }
              });
            });
          } else if (cmd.type === 'detach-crt') {
            const gapStart = Date.now();
            exports.c64_removeCartridge();
            exports.c64_reset(); // return to clean BASIC prompt
            const gapMs = Date.now() - gapStart;
            resetSidRing();
            if (webrtcEncoder) {
              webrtcEncoder.pushSilenceForGap(gapMs);
              if (verbose) console.error(`[headless] pushed ${gapMs}ms silence after detach`);
            }
            if (webrtcServer) webrtcServer.forceKeyframe(webrtcEncoder?.videoTrack);
            if (verbose) console.error('[headless] cart detached');
            else if (logEvents) console.error(`[event] cart-detached gap=${gapMs}ms`);
          } else if (cmd.type === 'hard-reset') {
            // Instant hard reset: reset machine state but keep current media
            // attached (cartridge/disk), matching offline player behavior.
            const gapStart = Date.now();
            exports.c64_reset();
            const gapMs = Date.now() - gapStart;
            resetSidRing();
            if (webrtcEncoder) {
              webrtcEncoder.pushSilenceForGap(gapMs);
              if (verbose) console.error(`[headless] pushed ${gapMs}ms silence after hard reset`);
            }
            if (webrtcServer) webrtcServer.forceKeyframe(webrtcEncoder?.videoTrack);
            if (verbose) console.error('[headless] hard reset');
            else if (logEvents) console.error(`[event] hard-reset gap=${gapMs}ms`);
          } else if (cmd.type === 'reboot') {
            if (!C64WASMClass) throw new Error('C64WASM wrapper unavailable for reboot');
            const gapStart = Date.now();
            const next = new C64WASMClass();
            await next.instantiate(wasmAb);
            c64wasm = next;
            exports = c64wasm.exports;
            heap = c64wasm.heap;
            exports.c64_init();
            exports.sid_setSampleRate(44100);
            exports.debugger_set_speed(100);
            exports.debugger_play();
            const gapMs = Date.now() - gapStart;
            resetSidRing();
            if (webrtcEncoder) {
              webrtcEncoder.pushSilenceForGap(gapMs);
              if (verbose) console.error(`[headless] pushed ${gapMs}ms silence after reboot`);
            }
            if (webrtcServer) webrtcServer.forceKeyframe(webrtcEncoder?.videoTrack);
            if (verbose) console.error('[headless] emulator rebooted (fresh WASM instance)');
            else if (logEvents) console.error(`[event] machine-rebooted gap=${gapMs}ms`);
          }
        },
        onInput: (event) => {
          if (!exports) return;
          if (event.type === 'joystick') {
            const port = (event.joystickPort ?? 2) - 1; // 1-based → 0-based
            const dir = event.direction ? (dirMap[event.direction] ?? 0) : 0;
            const fire = event.fire || event.fire1 ? 0x10 : 0;
            if (event.action === 'release') {
              if (dir) exports.c64_joystick_release(port, dir);
              if (fire) exports.c64_joystick_release(port, fire);
            } else {
              if (dir) exports.c64_joystick_push(port, dir);
              if (fire) exports.c64_joystick_push(port, fire);
            }
            if (verbose) {
              const role = event._role ?? 'unknown';
              console.error(
                `[event] input joystick role=${role} port=${event.joystickPort ?? 2} action=${event.action ?? 'press'} dir=${event.direction ?? '-'} fire=${!!(event.fire || event.fire1)}`,
              );
            }
          } else if (event.type === 'key') {
            const domKey = String(event.key ?? '');
            const shiftKey = !!event.shiftKey;
            const evType = event.action === 'up' ? 'keyup' : 'keydown';
            const c64acts = domKeyToC64Actions(domKey, shiftKey, evType);
            for (const act of c64acts) {
              if (act.action === 'press') exports.keyboard_keyPressed(act.key);
              else exports.keyboard_keyReleased(act.key);
            }
            if (verbose && c64acts.length > 0) {
              const role = event._role ?? 'unknown';
              console.error(
                `[input] input key role=${role} ${evType} "${domKey}" → ${JSON.stringify(c64acts)}`,
              );
            }
          }
        },
      });
      out.push(`Input server listening on ws://0.0.0.0:${wsPort}`);
    } catch (e) {
      console.error('[headless] Failed to start input server:', e && e.message ? e.message : e);
      out.push(`input-server-failed: ${String(e)}`);
    }
  }

  // ── WebRTC server (low-latency streaming, replaces RTMP+flv.js) ─────────
  // Started when --webrtc is passed. Opens an HTTP+WS signalling server on
  // webrtcPort (default 9002). Each connecting browser gets its own
  // RTCPeerConnection fed by the shared encoder tracks.
  let webrtcEncoder = null;
  let webrtcServer = null;
  let getWebrtcTelemetry = () => null;
  let getWebrtcPeerSnapshot = () => null;
  let disconnectWebrtcPeersByAddr = () => 0;
  let disconnectAllWebrtcPeers = () => 0;

  if (webrtc) {
    try {
      const { WebRTCEncoder } = await import('./webrtc-encoder.mjs');
      const { createWebRTCServer } = await import('./webrtc-server.mjs');
      const wrtcLib = (await import('@roamhq/wrtc')).default;
      const { MediaStream } = wrtcLib;

      webrtcEncoder = new WebRTCEncoder();
      webrtcEncoder.init({ width: 384, height: 272, sampleRate: 44100 });

      const { videoTrack, audioTrack } = webrtcEncoder;

      webrtcServer = createWebRTCServer({
        port: webrtcPort,
        verbose,
        logEvents,
        inputPort: wsPort,
        maxSpectators,
        minBitrateKbps: webrtcMinBitrateKbpsSafe,
        maxBitrateKbps: webrtcMaxBitrateKbpsSafe,
        // onOffer fires BEFORE createAnswer() — the right place to addTrack()
        onOffer(pc) {
          const stream = new MediaStream([videoTrack, audioTrack]);
          pc.addTrack(videoTrack, stream);
          pc.addTrack(audioTrack, stream);
          if (verbose) console.error('[webrtc] tracks attached to peer');
        },
        onPeerConnected(pc) {
          if (verbose) console.error('[webrtc] peer ICE connected');
          // Reduce video sender bitrate after connection to minimise encode
          // latency. A tight ceiling keeps frame sizes small and predictable,
          // reducing the encoder's internal queue and decode buffer on the
          // receiving end.
          try {
            const senders = pc.getSenders();
            for (const sender of senders) {
              if (sender.track && sender.track.kind === 'video') {
                const params = sender.getParameters();
                const maxBitrateBps = Math.max(
                  100_000,
                  Math.round(webrtcMaxBitrateKbpsSafe * 1000),
                );
                if (params.encodings && params.encodings.length > 0) {
                  params.encodings[0].maxBitrate = maxBitrateBps;
                } else {
                  params.encodings = [{ maxBitrate: maxBitrateBps }];
                }
                sender.setParameters(params).catch(() => {});
                break;
              }
            }
          } catch (_) {}
        },
      });
      if (typeof webrtcServer.getTelemetrySnapshot === 'function') {
        getWebrtcTelemetry = () => webrtcServer.getTelemetrySnapshot();
      }
      if (typeof webrtcServer.getPeerSnapshot === 'function') {
        getWebrtcPeerSnapshot = () => webrtcServer.getPeerSnapshot();
      }
      if (typeof webrtcServer.disconnectPeersByAddr === 'function') {
        disconnectWebrtcPeersByAddr = (addr, reason) =>
          webrtcServer.disconnectPeersByAddr(addr, reason);
      }
      if (typeof webrtcServer.disconnectAllPeers === 'function') {
        disconnectAllWebrtcPeers = (reason) => webrtcServer.disconnectAllPeers(reason);
      }

      out.push(
        `WebRTC player at http://0.0.0.0:${webrtcPort}/ (send cap: ${webrtcOutputFpsSafe > 0 ? `${webrtcOutputFpsSafe}fps` : 'off'})`,
      );
    } catch (e) {
      console.error('[headless] Failed to start WebRTC server:', e && e.message ? e.message : e);
      out.push(`webrtc-server-failed: ${String(e)}`);
      webrtc = false;
    }
  }

  // Run state and timing
  let frameCount = 0;
  let ffmpegDied = false; // set to true if ffmpeg exits unexpectedly and we give up
  const targetFps = typeof fps === 'number' && !Number.isNaN(fps) && fps > 0 ? fps : 60;
  const frameMs = Math.round(1000 / targetFps);
  const webrtcSendFps =
    webrtcOutputFpsSafe > 0 ? Math.max(1, Math.min(targetFps, webrtcOutputFpsSafe)) : targetFps;
  const webrtcSendIntervalMs = 1000 / webrtcSendFps;
  let nextVideoDueAtMs = nowMonoMs();
  let videoFramesSent = 0;
  let videoFramesDroppedLate = 0;
  let videoFramesDroppedCap = 0;
  let videoFramesDroppedLateWindow = 0;
  let videoFramesDroppedCapWindow = 0;
  runtimeStats.webrtcSendFps = webrtcSendFps;
  // Now that targetFps is known, configure the WebRTC encoder's frame duration
  // so video timestamps are driven by frame count × frame duration (µs) rather
  // than wall clock — making loadCartridge blockages invisible to the receiver.
  if (webrtcEncoder) webrtcEncoder.setFps(targetFps);

  // ── Event loop lag monitoring (for input flood investigation) ─────────────
  let eventLoopMonitor = null;
  let eventLoopLogTimer = null;
  try {
    const perfHooks = await import('perf_hooks');
    eventLoopMonitor = perfHooks.monitorEventLoopDelay();
    eventLoopMonitor.enable();
    const EVENT_LOOP_LOG_MS = 5000;
    eventLoopLogTimer = setInterval(() => {
      const lag = eventLoopMonitor ? eventLoopMonitor.min / 1e6 : 0; // ms
      // Keep event-loop lag diagnostics behind --verbose only. These can be
      // noisy in steady-state and are intended for performance debugging.
      if (lag > 5 && verbose) {
        // only log if >5ms lag
        console.error(`[event] event-loop-lag min=${lag.toFixed(2)}ms`);
      }
      if (eventLoopMonitor) eventLoopMonitor.reset();
    }, EVENT_LOOP_LOG_MS);
  } catch (e) {
    // perf_hooks not available (e.g., old Node) — skip monitoring
  }

  // ── Audio timing ──────────────────────────────────────────────────────────
  const audioSampleRate = 44100;
  const FALLBACK_DELTA_MS = 1000 / 60;
  const MAX_DELTA_MS = 100;
  const MAX_AUDIO_SAMPLES_PER_ITER = Math.ceil((audioSampleRate * MAX_DELTA_MS) / 1000);
  let audioInterval = null;

  // SID audio design — two-stage pipeline:
  //
  // Stage 1 (WASM → JS ring):
  //   Call sid_getAudioBuffer() exactly once per SID_BUFFER_SIZE samples of
  //   emulated audio (every ~4.65 video frames at 50fps). This is the ONLY
  //   safe call rate — calling it more often resets the SID's internal write
  //   counter and causes runaway emulation speed (per AGENTS.md).
  //   Each pull copies the full 4096-sample WASM buffer into a JS-side ring.
  //
  // Stage 2 (JS ring → ffmpeg/WebRTC):
  //   Every loop iteration, dequeue samples based on REAL elapsed wall-clock
  //   time, not target fps. This keeps audio throughput anchored to 44100 Hz
  //   even if the loop temporarily runs at 42fps, preventing A/V clock drift.
  //   The ring provides the decoupling: WASM pushes in 4096-sample chunks,
  //   consumers pull in 882-sample chunks.
  //
  // Ring sizing: hold at least 2× SID_BUFFER_SIZE so one full WASM pull
  // never overflows while the consumer hasn't caught up yet.
  const SID_RING_SIZE = SID_BUFFER_SIZE * 4; // 16384 samples of headroom
  const sidRing = new Float32Array(SID_RING_SIZE);
  let sidRingWrite = 0; // next write position in sidRing
  let sidRingRead = 0; // next read  position in sidRing
  let sidRingCount = 0; // samples currently in the ring
  // Accumulator: how many emulated samples have passed since last WASM pull.
  let sidSampleAccum = 0;
  // Single staging buffer for per-frame audio delivered to ffmpeg/WebRTC.
  const sidFrameBufMax = new Float32Array(MAX_AUDIO_SAMPLES_PER_ITER);
  let sidFrameView = sidFrameBufMax.subarray(0, 1);

  /** Pull one 4096-sample chunk from the WASM SID buffer into the JS ring. */
  function pullSidBuffer() {
    if (!exports || !heap || typeof exports.sid_getAudioBuffer !== 'function') return;
    try {
      const ptr = exports.sid_getAudioBuffer();
      const base = ptr >> 2;
      const src = heap.heapF32;
      for (let i = 0; i < SID_BUFFER_SIZE; i++) {
        sidRing[(sidRingWrite + i) % SID_RING_SIZE] = src[base + i];
      }
      sidRingWrite = (sidRingWrite + SID_BUFFER_SIZE) % SID_RING_SIZE;
      sidRingCount = Math.min(sidRingCount + SID_BUFFER_SIZE, SID_RING_SIZE);
    } catch (_) {}
  }

  /**
   * Re-prime the JS SID ring with 2 full WASM buffer pulls (~8192 samples).
   * Must be called after any emulator reset/cart-change once the WASM SID's
   * own write cursor has been restarted — i.e. AFTER resetSidRing() zeros
   * the JS ring state.  Runs ~186ms of emulated pre-roll (not captured).
   */
  function primeSidRing() {
    if (!exports || typeof exports.debugger_update !== 'function') return;
    const primeMs = Math.ceil(SID_BUFFER_SIZE / (audioSampleRate / 1000)); // ~93ms
    for (let p = 0; p < 2; p++) {
      exports.debugger_update(primeMs);
      pullSidBuffer();
    }
  }

  /** Dequeue n samples from JS ring into sidFrameBufMax and expose sidFrameView. */
  function dequeueSidFrame(n) {
    const samplesNeeded = Math.max(1, Math.min(n, MAX_AUDIO_SAMPLES_PER_ITER));
    sidFrameView = sidFrameBufMax.subarray(0, samplesNeeded);
    // If the ring doesn't have a full frame yet, pad with silence rather than
    // stalling — this can happen on the very first frames before the SID has
    // had time to fill a full 4096-sample chunk.
    if (sidRingCount < samplesNeeded) {
      sidFrameBufMax.fill(0, 0, samplesNeeded);
      return false;
    }
    for (let i = 0; i < samplesNeeded; i++) {
      sidFrameBufMax[i] = sidRing[(sidRingRead + i) % SID_RING_SIZE];
    }
    sidRingRead = (sidRingRead + samplesNeeded) % SID_RING_SIZE;
    sidRingCount -= samplesNeeded;
    return true;
  }

  // Resolve output path once — treat remote URLs verbatim, local file paths
  // should be resolved relative to the current working directory (process.cwd()).
  // If no output provided, fall back to repoRoot/temp as before.
  const isRemoteUrl = (s) => /^[a-zA-Z]+:\/\//.test(s);
  const outPathResolved = output
    ? isRemoteUrl(output)
      ? output
      : path.resolve(process.cwd(), output)
    : path.join(repoRoot, 'temp', `c64-record-${Date.now()}.mp4`);
  const isRtmpOutput = isRemoteUrl(outPathResolved);

  // Setup ffmpeg runner if recording requested
  let ffmpegRunner = null;
  let frameSize = 384 * 272 * 4;

  // Helper: start (or restart) ffmpeg. Returns true on success.
  async function startFfmpeg() {
    ffmpegRunner = new FFmpegRunner();
    const started = await ffmpegRunner.start({
      output: outPathResolved,
      width: 384,
      height: 272,
      fps,
      duration: durationSec,
      raw,
      verbose,
      audio,
      sampleRate: audioSampleRate,
    });
    return started;
  }

  if (record) {
    try {
      const started = await startFfmpeg();
      if (!started) {
        const msg = 'ffmpeg-record-failed:start-failed';
        out.push(msg);
        console.error('[headless] ' + msg);
        return { ok: false, output: out };
      } else {
        const msg = `Recording to ${outPathResolved} (${durationSec ? durationSec + 's' : 'endless'} @ ${fps}fps${audio ? ' +audio' : ''})`;
        out.push(msg);
        console.error('[headless] ' + msg);
      }
    } catch (e) {
      out.push(`ffmpeg-record-failed: ${String(e)}`);
      record = false;
    }
  }

  // ── SID ring pre-prime ───────────────────────────────────────────────────
  // Without pre-priming, the ring starts empty and the first ~4 frames are
  // silent (sidSampleAccum hasn't crossed SID_BUFFER_SIZE yet).  Worse, the
  // ring drains to zero every ~4.65 frames (882 × 4 = 3528 < 4096) so the
  // 5th frame after each pull would also be silent in steady state.
  //
  // Fix: run 2× SID_BUFFER_SIZE worth of emulation (~186ms) before the frame
  // loop and pull both 4096-sample chunks into the JS ring.  The ring then
  // starts at 8192 samples — a comfortable ~9.3 frames of headroom — and
  // never runs dry because subsequent pulls always arrive before it reaches 0.
  //
  // This emulation is "throwaway" pre-roll: the pixel buffer is not captured
  // and the CPU state matches what a real C64 would be doing at startup.
  if (audio || (webrtc && webrtcEncoder)) {
    primeSidRing();
    if (verbose) console.error(`[headless] SID ring primed: ${sidRingCount} samples ready`);
  }

  // runStartTime is set AFTER ffmpeg starts so --duration counts from when
  // recording actually begins (after any RTMP probe/stabilisation delay).
  const runStartTime = Date.now();
  const isStreamingMode = record || webrtc;
  const endTime = isStreamingMode
    ? durationSec
      ? runStartTime + durationSec * 1000
      : Infinity
    : null;

  let windowStart = nowMonoMs();
  let windowCount = 0;
  let lastStepAt = nowMonoMs();

  while (isStreamingMode ? Date.now() < endTime : frameCount < frames) {
    try {
      if (verbose && frameCount % 50 === 0)
        console.error(`[headless] loop frameCount=${frameCount}`);

      // Capture frame start time BEFORE emulation so sleepMs accounts for
      // ALL work in this iteration (emulation + audio + video push + ffmpeg).
      const iterStart = nowMonoMs();
      // Drive emulation with real wall-clock delta to avoid long-term A/V drift
      // when actual loop FPS differs from target FPS.
      const nowMs = nowMonoMs();
      let emuDeltaMs = nowMs - lastStepAt;
      lastStepAt = nowMs;
      if (!emuDeltaMs || emuDeltaMs > MAX_DELTA_MS) emuDeltaMs = FALLBACK_DELTA_MS;

      // Run a single full-frame emulation step.
      // debugger_update() returns truthy when the emulator has completed a full
      // video frame (VSync). c64.js gates its redraw on both this return value
      // AND debugger_isRunning() — we mirror that here so we never push a stale
      // or repeated pixel buffer into WebRTC during boot/reset sequences.
      const frameReady = !!exports.debugger_update(emuDeltaMs);
      const isRunning = !!exports.debugger_isRunning();

      // ── Audio: pull from WASM SID → JS ring → per-frame slice ───────────
      // Audio runs every frame regardless of frameReady/isRunning so the WebRTC
      // audio clock stays continuous — gaps cause desync, not silence.
      if (audio || (webrtc && webrtcEncoder)) {
        const samplesThisIter = Math.max(1, Math.round((audioSampleRate * emuDeltaMs) / 1000));
        sidSampleAccum += samplesThisIter;
        while (sidSampleAccum >= SID_BUFFER_SIZE) {
          sidSampleAccum -= SID_BUFFER_SIZE;
          pullSidBuffer();
        }
        dequeueSidFrame(samplesThisIter); // fills sidFrameView (or silence)
      }

      // ── WebRTC: push video + audio into the live track ─────────────────
      if (webrtc && webrtcEncoder) {
        // Only push a video frame when the emulator confirms one is ready and
        // is actively running — mirrors c64.js: if (update && !!debugger_isRunning())
        if (frameReady && isRunning) {
          const nowVideoMs = nowMonoMs();
          if (nowVideoMs + 1 < nextVideoDueAtMs) {
            videoFramesDroppedCap++;
            videoFramesDroppedCapWindow++;
          } else {
            const overdueMs = Math.max(0, nowVideoMs - nextVideoDueAtMs);
            if (overdueMs >= webrtcSendIntervalMs) {
              const lateDrops = Math.floor(overdueMs / webrtcSendIntervalMs);
              videoFramesDroppedLate += lateDrops;
              videoFramesDroppedLateWindow += lateDrops;
              nextVideoDueAtMs += lateDrops * webrtcSendIntervalMs;
            }
            const ptr = exports.c64_getPixelBuffer();
            const rgba = heap.heapU8.subarray(ptr, ptr + 384 * 272 * 4);
            webrtcEncoder.pushVideoFrame(rgba);
            videoFramesSent++;
            nextVideoDueAtMs = Math.max(nextVideoDueAtMs + webrtcSendIntervalMs, nowVideoMs + 1);
          }
        }

        webrtcEncoder.pushAudioFrame(sidFrameView);
      }

      // Capture video frame and audio chunk, then write both atomically.
      // await writeFrame() provides genuine backpressure: the loop waits for
      // ffmpeg to consume each frame before advancing, so it can never run
      // faster than ffmpeg can encode — no burst/spin behaviour possible.
      if (record && ffmpegRunner) {
        // Check if ffmpeg died before attempting to write
        if (!ffmpegRunner.isAlive()) {
          const code = ffmpegRunner._exitCode;
          const errMsg = `ffmpeg process exited unexpectedly (code ${code}) after ${frameCount} frames`;
          out.push(errMsg);
          console.error(`[headless] ${errMsg}`);

          // For URL/RTMP outputs, retry with backoff — transient connection failures are normal
          if (isRtmpOutput) {
            const retryDelaySec = 10;
            console.error(`[headless] RTMP output — retrying ffmpeg in ${retryDelaySec}s...`);
            await new Promise((r) => setTimeout(r, retryDelaySec * 1000));
            try {
              const restarted = await startFfmpeg();
              if (restarted) {
                console.error('[headless] ffmpeg restarted successfully');
              } else {
                console.error('[headless] ffmpeg restart failed — giving up');
                ffmpegDied = true;
                record = false;
                break;
              }
            } catch (restartErr) {
              console.error('[headless] ffmpeg restart threw:', restartErr && restartErr.message);
              ffmpegDied = true;
              record = false;
              break;
            }
          } else {
            ffmpegDied = true;
            record = false;
            break;
          }
        }
        if (frameReady && isRunning) {
          const ptr = exports.c64_getPixelBuffer();
          const videoFrame = heap.heapU8.subarray(ptr, ptr + frameSize);
          const audioChunk = audio ? sidFrameView : null;
          await ffmpegRunner.writeFrame(videoFrame, audioChunk);
        }
      }
      // Throttle to target FPS, then yield so input events are committed
      // to WASM before the next debugger_update.
      //
      // Ordering matters for input latency:
      //   1. setTimeout(sleepMs)  — event loop sleeps; WebSocket 'message'
      //      I/O callbacks fire during this window and call onInput() which
      //      writes directly to WASM exports (keyboard_keyPressed, etc.)
      //   2. setImmediate yield   — runs after all pending I/O callbacks,
      //      guaranteeing any message that arrived right at the end of the
      //      sleep is also committed before we continue.
      //   3. top of next iteration: debugger_update() reads the now-current
      //      WASM input state.
      //
      // Worst-case input latency = one full frame (20ms @ 50fps): a keydown
      // that lands just AFTER step 2 waits until the following frame.
      // Average latency = half a frame (~10ms).
      const workMs = nowMonoMs() - iterStart;
      const sleepMs = Math.max(0, frameMs - workMs);
      if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
      await new Promise((r) => setImmediate(r)); // drain any remaining I/O callbacks
    } catch (_) {}
    frameCount++;
    // diagnostics
    windowCount++;
    if (windowCount >= 50) {
      const now = nowMonoMs();
      const secs = (now - windowStart) / 1000;
      const actualFps = windowCount / secs;
      windowStart = now;
      windowCount = 0;
      // Drift reporting: if actual FPS deviates more than 10% from target, warn.
      // Only emit when --log-events is set; never emit per-frame.
      if (logEvents || verbose) {
        const drift = actualFps - targetFps;
        const driftPct = Math.abs(drift / targetFps) * 100;
        if (driftPct > 10) {
          console.error(
            `[event] drift fps-actual=${actualFps.toFixed(1)} fps-target=${targetFps} drift=${drift > 0 ? '+' : ''}${drift.toFixed(1)} (${driftPct.toFixed(0)}%)`,
          );
        }
        // Keep per-window drop telemetry behind --verbose only.
        if (verbose && (videoFramesDroppedLateWindow > 0 || videoFramesDroppedCapWindow > 0)) {
          console.error(
            `[event] webrtc-video-drop sent=${videoFramesSent} late=${videoFramesDroppedLateWindow} cap=${videoFramesDroppedCapWindow} totalLate=${videoFramesDroppedLate} totalCap=${videoFramesDroppedCap} fpsCap=${webrtcSendFps}`,
          );
        }
      }
      runtimeStats.videoFramesSent = videoFramesSent;
      runtimeStats.videoFramesDroppedLate = videoFramesDroppedLate;
      runtimeStats.videoFramesDroppedCap = videoFramesDroppedCap;
      const webrtcTelemetry = getWebrtcTelemetry();
      if (webrtcTelemetry) {
        runtimeStats.webrtcPeerCount = webrtcTelemetry.peerCount ?? null;
        runtimeStats.webrtcAvgRttMs = Number.isFinite(webrtcTelemetry.avgRttMs)
          ? webrtcTelemetry.avgRttMs
          : null;
        runtimeStats.webrtcSendDelayMsPerPacket = Number.isFinite(
          webrtcTelemetry.sendDelayMsPerPacket,
        )
          ? webrtcTelemetry.sendDelayMsPerPacket
          : null;
        runtimeStats.webrtcEncodeMsPerFrame = Number.isFinite(webrtcTelemetry.encodeMsPerFrame)
          ? webrtcTelemetry.encodeMsPerFrame
          : null;
        runtimeStats.webrtcFramesSentPerSec = Number.isFinite(webrtcTelemetry.framesSentPerSec)
          ? webrtcTelemetry.framesSentPerSec
          : null;
        runtimeStats.webrtcFramesEncodedPerSec = Number.isFinite(
          webrtcTelemetry.framesEncodedPerSec,
        )
          ? webrtcTelemetry.framesEncodedPerSec
          : null;
        runtimeStats.webrtcBytesSentPerSec = Number.isFinite(webrtcTelemetry.bytesSentPerSec)
          ? webrtcTelemetry.bytesSentPerSec
          : null;
        runtimeStats.webrtcQualityLimitation = webrtcTelemetry.qualityLimitation ?? null;
      }
      runtimeStats.sampledAt = Date.now();
      if (videoFramesDroppedLateWindow > 0 || videoFramesDroppedCapWindow > 0) {
        videoFramesDroppedLateWindow = 0;
        videoFramesDroppedCapWindow = 0;
      }
    }
    if (verify && frameCount % 60 === 0) {
      const cycleCount = exports.c64_getCycleCount ? exports.c64_getCycleCount() : null;
      out.push(JSON.stringify({ pid: process.pid, frame: frameCount, cycles: cycleCount }));
      try {
        const pc = exports.c64_getPC ? exports.c64_getPC() : null;
        console.error(`[headless] verify: frame=${frameCount} pc=${pc} cycles=${cycleCount}`);
      } catch (_) {}
    }
  }

  const elapsed = (Date.now() - runStartTime) / 1000;
  out.push(`Run complete. frames=${frameCount} elapsed=${elapsed.toFixed(2)}s`);

  // ── Shut down input server ────────────────────────────────────────────────
  if (inputServer) {
    try {
      await inputServer.close();
      if (verbose) console.error('[headless] input server closed');
    } catch (e) {
      console.error('[headless] input server close error:', e && e.message ? e.message : e);
    }
  }

  // ── Shut down WebRTC server ───────────────────────────────────────────────
  if (webrtcServer) {
    try {
      await webrtcServer.close();
      if (verbose) console.error('[headless] webrtc server closed');
    } catch (e) {
      console.error('[headless] webrtc server close error:', e && e.message ? e.message : e);
    }
  }

  // ── Log file teardown ──────────────────────────────────────────────────────
  _teardownLogFile();

  if (record && ffmpegRunner) {
    // Clear audio interval if it was used (currently null/no-op)
    if (audioInterval) {
      clearInterval(audioInterval);
      audioInterval = null;
    }
    try {
      const saved = await ffmpegRunner.stop();
      // Verify the file exists and is non-empty
      try {
        // If the saved path is a URL (rtmp://, rtmps://, srt://, etc.)
        // there is no filesystem entry to stat — treat it as a published
        // network output and report success.
        if (typeof saved === 'string' && /^[a-zA-Z]+:\/\//.test(saved)) {
          out.push(`Published: ${saved}`);
        } else {
          const stat = await fs.stat(saved);
          if (stat.size > 0) out.push(`Saved: ${saved}`);
          else out.push(`Saved-empty: ${saved}`);
        }
      } catch (e) {
        out.push(`Saved-missing: ${saved} (${String(e)})`);
      }
    } catch (e) {
      out.push(`ffmpeg-stop-failed: ${String(e)}`);
    }
  }
  return { ok: !ffmpegDied, output: out };
}

export default runHeadless;

// If this file is executed directly, run the CLI.
try {
  const thisFile = fileURLToPath(import.meta.url);
  // Resolve argv[1] to an absolute path so running with a relative path
  // (e.g. `node src/headless/headless-cli.mjs`) still matches.
  const argv1Resolved = process.argv && process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (argv1Resolved && argv1Resolved === thisFile) {
    (async () => {
      const res = await runHeadless();
      if (res) {
        if (Array.isArray(res.output)) {
          for (const line of res.output) console.log(line);
        } else if (res.output) {
          console.log(res.output);
        }
        if (!res.ok) process.exit(1);
      }
      process.exit(0);
    })().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
} catch (e) {
  // ignore errors in CLI wrapper detection
}
