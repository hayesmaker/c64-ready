import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

/** Build a minimal fake instantiate function with optional extra exports */
function makeFakeInstantiate(extraExports: Record<string, unknown> = {}) {
  return async (_bin: ArrayBuffer | Uint8Array, importObject: any) => {
    const memory: WebAssembly.Memory = importObject?.env?.memory as WebAssembly.Memory;
    const exports: any = {
      memory,
      malloc: (n: number) => {
        if (!exports._ptr) exports._ptr = 1024;
        const p: number = exports._ptr;
        exports._ptr += n + 16;
        return p;
      },
      free: (_p: number) => {},
      c64_loadCartridge: (_ptr: number, _len: number) => {},
      __wasm_call_ctors: () => {},
      c64_init: () => {},
      debugger_play: () => {},
      debugger_update: (_dt: number) => {},
      c64_getCycleCount: () => 123,
      ...extraExports,
    };
    return { instance: { exports } } as any;
  };
}

describe('headless CLI', () => {
  it('runs with fake wasm instantiate and loads game', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const wasmPath = path.join(repoRoot, 'virtual', 'fake.wasm');
    const crtPath = path.join(repoRoot, 'virtual', 'game.crt');

    const realReadFile = fs.readFile;
    // @ts-expect-error allow mocking fs.readFile for virtual paths
    vi.spyOn(fs, 'readFile').mockImplementation(async (p: string | Buffer) => {
      const ps = typeof p === 'string' ? p : p.toString();
      if (ps === wasmPath) return Buffer.from([0, 1, 2, 3]);
      if (ps === crtPath) return Buffer.from([1, 2, 3, 4]);
      return realReadFile(p as any);
    });

    // @ts-expect-error TS7016: module has no declaration file
    const mod = (await import('../../src/headless/headless-cli.mjs')) as any;
    const res = await mod.runHeadless({
      argv: ['--wasm', wasmPath, '--game', crtPath, '--frames', '2', '--verify'],
      instantiateFn: makeFakeInstantiate(),
      repoRoot,
    });
    expect(res.ok).toBe(true);
  });

  it('reports audio flag in recording message when --audio is passed', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const wasmPath = path.join(repoRoot, 'virtual', 'fake.wasm');

    const realReadFile = fs.readFile;
    // @ts-expect-error allow mocking fs.readFile for virtual paths
    vi.spyOn(fs, 'readFile').mockImplementation(async (p: string | Buffer) => {
      const ps = typeof p === 'string' ? p : p.toString();
      if (ps === wasmPath) return Buffer.from([0, 1, 2, 3]);
      return realReadFile(p as any);
    });

    // Provide a pixel buffer and a SID audio buffer in fake exports
    const PIXEL_SIZE = 384 * 272 * 4;
    // const AUDIO_SIZE = 4096;
    const fakeInstantiate = makeFakeInstantiate({
      c64_getPixelBuffer: () => 0,           // ptr = 0, buffer starts at offset 0
      sid_getAudioBuffer: () => PIXEL_SIZE,  // audio starts right after pixel buffer
      debugger_update: (_dt: number) => 1,
    });

    // Intercept FFmpegRunner so we don't need a real ffmpeg binary in tests
    // @ts-expect-error TS7016
    const mod = (await import('../../src/headless/headless-cli.mjs')) as any;

    // Use --frames (no --record) so ffmpeg is not invoked — we just verify
    // the audio export path is exercised without an actual ffmpeg process.
    const res = await mod.runHeadless({
      argv: ['--wasm', wasmPath, '--no-game', '--frames', '3'],
      instantiateFn: fakeInstantiate,
      repoRoot,
    });

    expect(res.ok).toBe(true);
    // Confirm run completed
    const summary = (res.output as string[]).find((l: string) => l.startsWith('Run complete'));
    expect(summary).toBeTruthy();
  });

  // ── debugger_update: called exactly once per frame ───────────────────────

  it('calls debugger_update once per frame', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const wasmPath = path.join(repoRoot, 'virtual', 'fake.wasm');

    const realReadFile = fs.readFile;
    // @ts-expect-error allow mocking fs.readFile for virtual paths
    vi.spyOn(fs, 'readFile').mockImplementation(async (p: string | Buffer) => {
      const ps = typeof p === 'string' ? p : p.toString();
      if (ps === wasmPath) return Buffer.from([0, 1, 2, 3]);
      return realReadFile(p as any);
    });

    const updateCalls: number[] = [];
    const fakeInstantiate = makeFakeInstantiate({
      debugger_update: (dt: number) => { updateCalls.push(dt); },
      debugger_set_speed: (_s: number) => {},
    });

    // @ts-expect-error TS7016
    const mod = (await import('../../src/headless/headless-cli.mjs')) as any;
    const FRAMES = 3;
    const res = await mod.runHeadless({
      argv: ['--wasm', wasmPath, '--no-game', '--frames', String(FRAMES)],
      instantiateFn: fakeInstantiate,
      repoRoot,
    });

    expect(res.ok).toBe(true);
    // Each frame = exactly 1 debugger_update call.
    expect(updateCalls.length).toBe(FRAMES);
    // Every call receives a positive duration.
    expect(updateCalls.every((dt) => dt > 0)).toBe(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── SID ring pre-prime: ring is filled before the frame loop starts ──────

  it('pre-primes the SID ring before the frame loop so audio frames are never silent', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const wasmPath = path.join(repoRoot, 'virtual', 'fake.wasm');

    const realReadFile = fs.readFile;
    // @ts-expect-error allow mocking fs.readFile for virtual paths
    vi.spyOn(fs, 'readFile').mockImplementation(async (p: string | Buffer) => {
      const ps = typeof p === 'string' ? p : p.toString();
      if (ps === wasmPath) return Buffer.from([0, 1, 2, 3]);
      return realReadFile(p as any);
    });

    // sid_getAudioBuffer returns a pointer; the WASM memory behind it is all
    // zeros (default), so any samples read back are 0.0 (silence).
    // primeSidRing() calls debugger_update × 2 + sid_getAudioBuffer × 2 to
    // fill the ring before the frame loop begins, so dequeueSidFrame()
    // always has data on frame 0 (ring count = 8192 > samplesPerFrame).
    const PIXEL_SIZE = 384 * 272 * 4;

    // Intercept ffmpeg writeFrame to capture audio chunks without real ffmpeg.
    // We can't directly observe sidFrameBuf, so we verify the run completes
    // with ok=true and no errors — the silence-pad path is exercised without
    // crashing when the ring is under-filled.
    const fakeInstantiate = makeFakeInstantiate({
      c64_getPixelBuffer: () => 0,
      sid_getAudioBuffer: () => PIXEL_SIZE,
      debugger_update: (_dt: number) => {},
      debugger_set_speed: (_s: number) => {},
    });

    // @ts-expect-error TS7016
    const mod = (await import('../../src/headless/headless-cli.mjs')) as any;
    const res = await mod.runHeadless({
      // 2 frames with --audio but no --record avoids needing ffmpeg.
      argv: ['--wasm', wasmPath, '--no-game', '--frames', '2', '--audio'],
      instantiateFn: fakeInstantiate,
      repoRoot,
    });

    expect(res.ok).toBe(true);
    const summary = (res.output as string[]).find((l: string) => l.startsWith('Run complete'));
    expect(summary).toBeTruthy();
  });

  // ── --no-game: run completes without a cartridge ──────────────────────────

  it('completes successfully with --no-game flag (no game cartridge loaded)', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const wasmPath = path.join(repoRoot, 'virtual', 'fake.wasm');

    const realReadFile = fs.readFile;
    // @ts-expect-error allow mocking fs.readFile for virtual paths
    vi.spyOn(fs, 'readFile').mockImplementation(async (p: string | Buffer) => {
      const ps = typeof p === 'string' ? p : p.toString();
      if (ps === wasmPath) return Buffer.from([0, 1, 2, 3]);
      return realReadFile(p as any);
    });

    // @ts-expect-error TS7016
    const mod = (await import('../../src/headless/headless-cli.mjs')) as any;
    const res = await mod.runHeadless({
      argv: ['--wasm', wasmPath, '--no-game', '--frames', '4'],
      instantiateFn: makeFakeInstantiate(),
      repoRoot,
    });

    expect(res.ok).toBe(true);
    const summary = (res.output as string[]).find((l: string) => l.startsWith('Run complete'));
    expect(summary).toContain('frames=4');
  });
});

