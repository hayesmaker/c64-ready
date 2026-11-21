// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { inflateSync } from 'zlib';
import {
  parseAddr,
  parseRange,
  parsePoke,
  parseAction,
  parseArgs,
  parseSymbols,
  nearestSymbol,
  parseKeyName,
  parseJoy,
  textToPetscii,
  screenCodeToChar,
  runAgent,
} from '../../src/headless/agent-cli.mjs';
import { C64_KEY } from '../../src/headless/c64-key-map.mjs';
import { encodePng } from '../../src/headless/png.mjs';

const WASM = path.resolve(__dirname, '../../public/c64.wasm');

/**
 * Hand-assembled test program (BASIC stub `10 SYS2061`):
 *   $080d  lda #$2a / sta $c000
 *   $0812  loop: lda $dc00 / and #$10 / bne loop   ; wait for joystick-2 fire
 *   $0819  lda #$01 / sta $c001 / jmp loop
 */
const TEST_PRG = Uint8Array.from([
  0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00, 0xa9, 0x2a,
  0x8d, 0x00, 0xc0, 0xad, 0x00, 0xdc, 0x29, 0x10, 0xd0, 0xf9, 0xa9, 0x01, 0x8d, 0x01, 0xc0, 0x4c,
  0x12, 0x08,
]);
const TEST_SYMS = `.label start=$80d\n.label loop=$812\n.label fired=$819\n`;

describe('agent CLI — argument parsing', () => {
  it('parses addresses in hex, $hex, 0xhex and #decimal', () => {
    expect(parseAddr('$c000')).toBe(0xc000);
    expect(parseAddr('0xD020')).toBe(0xd020);
    expect(parseAddr('0801')).toBe(0x0801);
    expect(parseAddr('#49152')).toBe(49152);
    expect(() => parseAddr('zz')).toThrow(/Invalid address/);
    expect(() => parseAddr('$10000')).toThrow(/out of range/);
  });

  it('parses ranges and pokes', () => {
    expect(parseRange('$0400-$0427')).toEqual({ start: 0x400, end: 0x427 });
    expect(parseRange('c000:16')).toEqual({ start: 0xc000, end: 0xc00f });
    expect(parseRange('c000:$10')).toEqual({ start: 0xc000, end: 0xc00f });
    expect(parseRange('fff0:100')).toEqual({ start: 0xfff0, end: 0xffff });
    expect(parsePoke('d020=0,1,2')).toEqual({ addr: 0xd020, values: [0, 1, 2] });
    expect(() => parsePoke('d020=100')).toThrow(/Byte out of range/);
  });

  it('parses KickAssembler and VICE symbol files and resolves labels', () => {
    const syms = parseSymbols(
      '.label main=$80e\n.const SCREEN=$0400\n.namespace player {\n.label x=$1000\n}\nal C:c000 .irq\n',
    );
    expect(syms.get('main')).toBe(0x80e);
    expect(syms.get('SCREEN')).toBe(0x400);
    expect(syms.get('player.x')).toBe(0x1000);
    expect(syms.get('irq')).toBe(0xc000);
    expect(parseAddr('main+2', syms)).toBe(0x810);
    expect(parseRange('player.x:4', syms)).toEqual({ start: 0x1000, end: 0x1003 });
    expect(nearestSymbol(syms, 0x811)).toBe('main+3');
    expect(nearestSymbol(syms, 0x80e)).toBe('main');
    expect(nearestSymbol(syms, 0x9000)).toBeNull();
  });

  it('parses scheduled actions', () => {
    expect(parseAction('100:joy2=up+fire')).toEqual({
      frame: 100,
      kind: 'joy',
      port: 2,
      bits: 0x11,
    });
    expect(parseAction('5:joy1=none')).toEqual({ frame: 5, kind: 'joy', port: 1, bits: 0 });
    expect(parseAction('7:press=space+a')).toEqual({
      frame: 7,
      kind: 'press',
      keys: [C64_KEY.SPACE, C64_KEY.A],
    });
    expect(parseAction('9:type=run\\n')).toEqual({
      frame: 9,
      kind: 'type',
      bytes: [82, 85, 78, 13],
    });
    expect(parseAction('3:screenshot=a:b.png')).toEqual({
      frame: 3,
      kind: 'screenshot',
      path: 'a:b.png',
    });
    expect(() => parseAction('x:joy2=up')).toThrow(/Invalid frame/);
    expect(() => parseAction('1:dance=yes')).toThrow(/Unknown action/);
  });

  it('maps key names, joystick inputs and text', () => {
    expect(parseKeyName('return')).toBe(C64_KEY.RETURN);
    expect(parseKeyName('ENTER')).toBe(C64_KEY.RETURN);
    expect(parseKeyName('7')).toBe(C64_KEY.SEVEN);
    expect(parseKeyName('f1')).toBe(C64_KEY.F1);
    expect(() => parseKeyName('hyper')).toThrow(/Unknown C64 key/);
    expect(parseJoy('left+right')).toBe(0x0c);
    expect(() => parseJoy('sideways')).toThrow();
    expect(textToPetscii('Print 1\n')).toEqual([80, 82, 73, 78, 84, 32, 49, 13]);
    expect(() => textToPetscii('~')).toThrow(/Cannot type/);
  });

  it('decodes screen codes', () => {
    expect(screenCodeToChar(0x01, false)).toBe('A');
    expect(screenCodeToChar(0x81, false)).toBe('A'); // reverse video
    expect(screenCodeToChar(0x01, true)).toBe('a');
    expect(screenCodeToChar(0x41, true)).toBe('A');
    expect(screenCodeToChar(0x20, false)).toBe(' ');
    expect(screenCodeToChar(0x31, false)).toBe('1');
    expect(screenCodeToChar(0x51, false)).toBe('#');
  });

  it('rejects unknown options and loads symbols before other flags', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
    const o = parseArgs(['--break', 'loop', '--symbols', 'x.sym'], () => TEST_SYMS);
    expect(o.breaks).toEqual([0x812]);
  });
});

describe('png encoder', () => {
  it('writes a valid RGB PNG with optional upscale', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 255]);
    const png = encodePng(rgba, 2, 2, { scale: 2 });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(4); // width
    expect(png.readUInt32BE(20)).toBe(4); // height
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe((4 * 3 + 1) * 4);
    expect([...raw.subarray(0, 7)]).toEqual([0, 255, 0, 0, 255, 0, 0]);
  });
});

describe('agent CLI — end to end with the real WASM core', () => {
  let dir: string;
  let prg: string;
  let sym: string;
  const run = (args: string[]) => runAgent({ argv: ['--wasm', WASM, ...args], log: () => {} });

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c64-agent-'));
    prg = path.join(dir, 'test.prg');
    sym = path.join(dir, 'test.sym');
    await fs.writeFile(prg, TEST_PRG);
    await fs.writeFile(sym, TEST_SYMS);
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('boots to BASIC and types into the keyboard buffer', async () => {
    const r = await run(['--type', 'PRINT 6*7\\n', '--frames', '10', '--screen', '--json']);
    expect(r.exitCode).toBe(0);
    expect(r.report.screen).toContain('READY.');
    expect(r.report.screen).toMatch(/^ 42$/m);
    expect(JSON.parse(r.output).stopReason).toBe('frames');
  });

  it('runs a PRG, reacts to scripted joystick input, and dumps memory', async () => {
    const idle = await run([prg, '--frames', '30', '--dump', 'c000:2']);
    expect(idle.report.dumps[0].bytes).toEqual([0x2a, 0x00]);

    const fired = await run([prg, '--frames', '30', '--at', '10:joy2=fire', '--dump', 'c000:2']);
    expect(fired.report.dumps[0].bytes).toEqual([0x2a, 0x01]);
    expect(fired.report.type).toBe('prg');
    expect(fired.report.loadAddress).toBe(0x0801);
  });

  it('stops at a labelled breakpoint and reports the PC symbolically', async () => {
    const r = await run([
      prg,
      '--symbols',
      sym,
      '--break',
      'fired',
      '--at',
      '5:joy2=fire',
      '--frames',
      '50',
    ]);
    expect(r.report.stopReason).toBe('breakpoint');
    expect(r.report.regs.pc).toBe(0x819);
    expect(r.report.regs.pcLabel).toBe('fired');
    expect(r.report.framesRun).toBeLessThan(50);
    expect(r.output).toContain('PC=$0819 (fired)');
  });

  it('exits 3 when --until-text is never reached', async () => {
    const hit = await run([
      '--type',
      'PRINT "PA"+"SS"\\n',
      '--until-text',
      'PASS',
      '--frames',
      '50',
    ]);
    expect(hit.report.stopReason).toBe('until-text');
    expect(hit.exitCode).toBe(0);
    const miss = await run(['--until-text', 'NEVER', '--frames', '5']);
    expect(miss.report.stopReason).toBe('until-text-timeout');
    expect(miss.exitCode).toBe(3);
  });

  it('keeps the core watermark out of screenshots, even on the first frame', async () => {
    // The core draws grey `lvllvl` text just right of centre for the first 40
    // c64_getPixelBuffer() reads; runAgent reads past that at start-up.
    const shot = path.join(dir, 'wm.png');
    await run(['--frames', '1', '--no-run', '--screenshot', shot]);
    const png = await fs.readFile(shot);
    const width = png.readUInt32BE(16);
    const idat: Buffer[] = [];
    for (let o = 8; o < png.length; ) {
      const len = png.readUInt32BE(o);
      if (png.toString('ascii', o + 4, o + 8) === 'IDAT')
        idat.push(png.subarray(o + 8, o + 8 + len));
      o += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat)); // filter 0, RGB rows
    let grey = 0;
    for (let y = 128; y < 142; y++) {
      for (let x = 180; x < 208; x++) {
        const i = y * (width * 3 + 1) + 1 + x * 3;
        const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]];
        if (r === g && g === b && r > 60 && r < 230) grey++;
      }
    }
    expect(grey).toBe(0);
  });

  it('writes screenshots at scheduled frames and at the end', async () => {
    const mid = path.join(dir, 'mid.png');
    const end = path.join(dir, 'end.png');
    const r = await run(['--frames', '5', '--at', `2:screenshot=${mid}`, '--screenshot', end]);
    expect(r.report.screenshots).toEqual([mid, end]);
    const png = await fs.readFile(end);
    expect(png.readUInt32BE(16)).toBe(384);
    expect(png.readUInt32BE(20)).toBe(272);
  });

  it('warns instead of guessing when a PRG does not load at $0801', async () => {
    const odd = path.join(dir, 'c000.prg');
    await fs.writeFile(odd, Uint8Array.from([0x00, 0xc0, 0xee, 0x20, 0xd0, 0x4c, 0x00, 0xc0]));
    const r = await run([odd, '--frames', '2']);
    expect(r.report.warnings.join(' ')).toMatch(/\$c000.*--sys/);
    const started = await run([odd, '--sys', 'c000', '--frames', '10', '--break', 'c003']);
    expect(started.report.stopReason).toBe('breakpoint');
  });

  it('returns a short error for bad arguments', async () => {
    const r = await run(['--frames', '-1']);
    expect(r.exitCode).toBe(1);
    expect(r.output).toMatch(/^c64-agent: error: --frames/);
  });
});
