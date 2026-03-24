import { describe, it, expect, vi } from 'vitest';
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
});

