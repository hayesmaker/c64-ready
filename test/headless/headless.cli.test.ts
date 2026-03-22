import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

describe('headless CLI', () => {
  it('runs with fake wasm instantiate and loads game', async () => {
    // Avoid touching disk in tests — use fake paths and mock fs.readFile
    const repoRoot = path.resolve(__dirname, '..', '..');
    const wasmPath = path.join(repoRoot, 'virtual', 'fake.wasm');
    const crtPath = path.join(repoRoot, 'virtual', 'game.crt');

    // Intercept fs.readFile calls and return in-memory buffers for our
    // virtual paths. Any other path will throw to help catch unexpected IO.
    const realReadFile = fs.readFile;
    // @ts-expect-error allow mocking fs.readFile for virtual paths
    vi.spyOn(fs, 'readFile').mockImplementation(async (p: string | Buffer) => {
      const ps = typeof p === 'string' ? p : p.toString();
      if (ps === wasmPath) return Buffer.from([0, 1, 2, 3]);
      if (ps === crtPath) return Buffer.from([1, 2, 3, 4]);
      return realReadFile(p as any);
    });

    // fake instantiate that provides minimal exports
    const fakeInstantiate = async (_bin: ArrayBuffer | Uint8Array, importObject: any) => {
      const memory: WebAssembly.Memory = importObject?.env?.memory as WebAssembly.Memory;
      // prepare a memory buffer large enough
      const exports: any = {
        memory,
        malloc: (n: number) => {
          // simple bump allocator at offset 1024
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
      };
      return { instance: { exports } } as any;
    };

    // @ts-expect-error TS7016: module has no declaration file
    const mod = (await import('../../src/headless/headless-cli.mjs')) as any;
    const res = await mod.runHeadless({
      argv: ['--wasm', wasmPath, '--game', crtPath, '--frames', '2', '--verify'],
      instantiateFn: fakeInstantiate,
      repoRoot,
    });
    expect(res.ok).toBe(true);
  });
});

