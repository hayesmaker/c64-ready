import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

// Use dynamic import inside the test and cast to `any` to avoid requiring
// a declaration file for the ESM module during TS type-checking.

describe('headless CLI', () => {
  it('runs with fake wasm instantiate and loads game', async () => {
    // create temp files inside repo temp dir
    const repoRoot = path.resolve(__dirname, '..', '..');
    const tmpDir = path.join(repoRoot, 'temp', 'test-headless');
    await fs.mkdir(tmpDir, { recursive: true });
    const wasmPath = path.join(tmpDir, 'fake.wasm');
    const crtPath = path.join(tmpDir, 'game.crt');
    await fs.writeFile(wasmPath, Buffer.from([0, 1, 2, 3]));
    await fs.writeFile(crtPath, Buffer.from([1, 2, 3, 4]));

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

    // The ESM CLI module lives at ./headless-cli.mjs and we have a .d.ts
    // alongside it, but TS may still complain in certain test environments.
    // Silence that specific import error here and cast to any for the test.
    // @ts-ignore TS7016: module has no declaration file
    const mod = (await import('./headless-cli.mjs')) as any;
    const res = await mod.runHeadless({ argv: ['--wasm', wasmPath, '--game', crtPath, '--frames', '2', '--verify'], instantiateFn: fakeInstantiate, repoRoot });
    expect(res.ok).toBe(true);
    // startup message
    expect(res.output.some((l: string) => l.includes('Starting headless C64'))).toBe(true);
    // run complete
    expect(res.output.some((l: string) => l.includes('Run complete. frames=2'))).toBe(true);
  });
});

