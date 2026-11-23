// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import net from 'net';
import path from 'path';
import WebSocket from 'ws';
// @ts-expect-error TS7016: module has no declaration file
import { patchWasm } from '../../tools/patch-wasm-exports.mjs';
// @ts-expect-error TS7016: module has no declaration file
import { C64WASM } from '../../src/headless/c64-wasm.mjs';
// @ts-expect-error TS7016: module has no declaration file
import * as keyMap from '../../src/headless/c64-key-map.mjs';

const { C64_KEY, pressC64Key, releaseC64Key, pulseRestore } = keyMap;

const REPO = path.resolve(__dirname, '..', '..');
const WASM_PATH = path.join(REPO, 'public', 'c64.wasm');

// ── tools/patch-wasm-exports.mjs ────────────────────────────────────────────

/** Minimal module: types ()->() and (i32)->(), func 0 exported as "a", func 1 unexported. */
function tinyModule(): Buffer {
  return Buffer.from([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00, // header
    0x01,
    0x08,
    0x02,
    0x60,
    0x00,
    0x00,
    0x60,
    0x01,
    0x7f,
    0x00, // type
    0x03,
    0x03,
    0x02,
    0x00,
    0x01, // function
    0x07,
    0x05,
    0x01,
    0x01,
    0x61,
    0x00,
    0x00, // export "a" -> func 0
    0x0a,
    0x07,
    0x02,
    0x02,
    0x00,
    0x0b,
    0x02,
    0x00,
    0x0b, // code
  ]);
}

const exportNames = (bin: Buffer) =>
  WebAssembly.Module.exports(new WebAssembly.Module(new Uint8Array(bin))).map((e) => e.name);

describe('patch-wasm-exports', () => {
  it('appends an export for an internal function and keeps the module valid', () => {
    const { bin, added } = patchWasm(tinyModule(), [
      { name: 'b', func: 1, params: ['i32'], results: [] },
    ]);
    expect(added).toEqual(['b']);
    expect(exportNames(bin)).toEqual(['a', 'b']);
  });

  it('is idempotent', () => {
    const extra = [{ name: 'b', func: 1, params: ['i32'], results: [] }];
    const once = patchWasm(tinyModule(), extra).bin;
    const twice = patchWasm(once, extra);
    expect(twice.added).toEqual([]);
    expect(Buffer.compare(twice.bin, once)).toBe(0);
  });

  it('refuses to export a function whose signature does not match', () => {
    expect(() =>
      patchWasm(tinyModule(), [{ name: 'b', func: 0, params: ['i32'], results: [] }]),
    ).toThrow(/refusing to patch/);
  });

  it('public/c64.wasm already exports c64_nmiLine (func 396, past the imports)', () => {
    const bin = fs.readFileSync(WASM_PATH);
    expect(exportNames(bin)).toContain('c64_nmiLine');
    expect(patchWasm(bin).added).toEqual([]);
    // Re-exporting func 396 under another name exercises the import-aware signature check.
    const probe = patchWasm(bin, [{ name: 'probe', func: 396, params: ['i32'], results: [] }]);
    expect(exportNames(probe.bin)).toContain('probe');
  });
});

// ── RESTORE behaviour on the real core ──────────────────────────────────────

const FRAME_MS = 20;

async function boot() {
  const bin = fs.readFileSync(WASM_PATH);
  const w = new C64WASM();
  await w.instantiate(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const x = w.exports;
  x.c64_init();
  x.sid_setSampleRate(44100);
  x.debugger_set_speed(100);
  x.debugger_play();
  const run = (n: number) => {
    for (let i = 0; i < n; i++) x.debugger_update(FRAME_MS);
  };
  run(150);
  return { x, run };
}

/** NMI handler at $C000 (INC $C100 / RTI), hooked through the KERNAL's $0318 vector. */
function installNmiCounter(x: any) {
  [0xee, 0x00, 0xc1, 0x40].forEach((v, i) => x.c64_cpuWrite(0xc000 + i, v));
  x.c64_cpuWrite(0xc100, 0);
  x.c64_cpuWrite(0x0318, 0x00);
  x.c64_cpuWrite(0x0319, 0xc0);
  return () => x.c64_cpuReadNS(0xc100);
}

describe('RESTORE key (real core)', () => {
  it('raises one NMI per press, even when held or auto-repeated', async () => {
    const { x, run } = await boot();
    const nmis = installNmiCounter(x);

    pressC64Key(x, C64_KEY.RESTORE);
    run(2);
    pressC64Key(x, C64_KEY.RESTORE); // auto-repeat
    run(2);
    expect(nmis()).toBe(1);

    releaseC64Key(x, C64_KEY.RESTORE);
    pressC64Key(x, C64_KEY.RESTORE);
    run(2);
    expect(nmis()).toBe(2);
  });

  it('RUN/STOP + RESTORE warm-starts; RESTORE alone does not', async () => {
    const { x, run } = await boot();
    x.c64_cpuWrite(0xd020, 2);

    pressC64Key(x, C64_KEY.RESTORE);
    releaseC64Key(x, C64_KEY.RESTORE);
    run(10);
    expect(x.c64_cpuReadNS(0xd020) & 15).toBe(2);

    pressC64Key(x, C64_KEY.RUN_STOP);
    run(3);
    pressC64Key(x, C64_KEY.RESTORE);
    releaseC64Key(x, C64_KEY.RESTORE);
    run(5);
    releaseC64Key(x, C64_KEY.RUN_STOP);
    run(20);
    expect(x.c64_cpuReadNS(0xd020) & 15).toBe(14); // default light blue border
  });

  it('is blocked while an unacknowledged CIA2 NMI holds the line, as on hardware', async () => {
    const { x, run } = await boot();
    const nmis = installNmiCounter(x);
    // CIA2 timer A one-shot NMI; the handler never reads $DD0D, so the line stays low.
    x.c64_cpuWrite(0xdd04, 0x10);
    x.c64_cpuWrite(0xdd05, 0x00);
    x.c64_cpuWrite(0xdd0d, 0x81);
    x.c64_cpuWrite(0xdd0e, 0x19);
    run(2);
    expect(nmis()).toBe(1);

    expect(pulseRestore(x)).toBe(true);
    run(2);
    expect(nmis()).toBe(1);

    x.c64_cpuRead(0xdd0d); // acknowledge
    run(1);
    pulseRestore(x);
    run(2);
    expect(nmis()).toBe(2);
  });

  it('never sends RESTORE to the keyboard matrix, even without c64_nmiLine', () => {
    const x = { keyboard_keyPressed: vi.fn(), keyboard_keyReleased: vi.fn() };
    expect(pulseRestore(x)).toBe(false);
    pressC64Key(x, C64_KEY.RESTORE);
    releaseC64Key(x, C64_KEY.RESTORE);
    expect(x.keyboard_keyPressed).not.toHaveBeenCalled();
    expect(x.keyboard_keyReleased).not.toHaveBeenCalled();

    pressC64Key(x, C64_KEY.A);
    releaseC64Key(x, C64_KEY.A);
    expect(x.keyboard_keyPressed).toHaveBeenCalledWith(C64_KEY.A);
    expect(x.keyboard_keyReleased).toHaveBeenCalledWith(C64_KEY.A);
  });
});

// ── --no-host-auth ──────────────────────────────────────────────────────────

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** Connect, wait for hello, claim host without a token, and report what came back. */
function claimHostWithoutToken(
  port: number,
): Promise<{ hostAuthRequired: boolean; reply: string }> {
  return new Promise((resolve, reject) => {
    let hostAuthRequired: boolean | undefined;
    const attempt = (triesLeft: number) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on('error', () => {
        if (triesLeft > 0) setTimeout(() => attempt(triesLeft - 1), 50);
        else reject(new Error('input server never came up'));
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'hello') {
          hostAuthRequired = msg.hostAuthRequired;
          ws.send(JSON.stringify({ type: 'host', username: 'dev' }));
        } else if (msg.type === 'host-confirmed' || msg.type === 'host-auth-failed') {
          ws.close();
          resolve({ hostAuthRequired: hostAuthRequired as boolean, reply: msg.type });
        }
      });
    };
    attempt(60);
  });
}

describe('headless --no-host-auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runWithInput(extraArgs: string[]) {
    // @ts-expect-error TS7016: module has no declaration file
    const mod = (await import('../../src/headless/headless-cli.mjs')) as any;
    const port = await freePort();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Frames are paced at --fps in real time, leaving ~3 s for the client to connect.
    const run = mod.runHeadless({
      argv: [
        '--wasm',
        WASM_PATH,
        '--no-game',
        '--input',
        '--ws-port',
        String(port),
        '--fps',
        '50',
        '--frames',
        '150',
        ...extraArgs,
      ],
      repoRoot: REPO,
    });
    const result = await claimHostWithoutToken(port);
    await run;
    return result;
  }

  it('lets a browser take host controls without a token', async () => {
    const res = await runWithInput(['--no-host-auth']);
    expect(res).toEqual({ hostAuthRequired: false, reply: 'host-confirmed' });
  }, 15000);

  it('still requires the admin token by default', async () => {
    const res = await runWithInput([]);
    expect(res).toEqual({ hostAuthRequired: true, reply: 'host-auth-failed' });
  }, 15000);
});
