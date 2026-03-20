import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C64WASM } from './c64-wasm';

describe('C64WASM', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when updateHeapViews is called before memory init', () => {
    const wasm = new C64WASM();
    expect(() => wasm.updateHeapViews()).toThrow('WASM memory not initialized');
  });

  it('instantiates wasm and calls ctors', async () => {
    const ctors = vi.fn();
    const instantiateSpy = vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
      instance: {
        exports: {
          __wasm_call_ctors: ctors,
        },
      },
      module: {} as WebAssembly.Module,
    } as WebAssembly.WebAssemblyInstantiatedSource);

    const wasm = new C64WASM();
    await wasm.instantiate(new ArrayBuffer(8));

    expect(instantiateSpy).toHaveBeenCalledOnce();
    expect(wasm.exports).toBeTruthy();
    expect(wasm.heap).toBeTruthy();
    expect(ctors).toHaveBeenCalledOnce();
  });

  it('wraps instantiate failures with a clear error', async () => {
    vi.spyOn(WebAssembly, 'instantiate').mockRejectedValue(new Error('boom'));

    const wasm = new C64WASM();
    await expect(wasm.instantiate(new ArrayBuffer(8))).rejects.toThrow('WASM instantiation failed');
  });

  it('allocates and writes bytes to heap', () => {
    const wasm = new C64WASM();
    wasm.exports = {
      malloc: vi.fn(() => 4),
      free: vi.fn(),
    } as any;

    const heapU8 = new Uint8Array(32);
    wasm.heap = {
      heapU8,
      heapF32: new Float32Array(heapU8.buffer),
      heapU32: new Uint32Array(heapU8.buffer),
    };

    const data = new Uint8Array([10, 20, 30]);
    const ptr = wasm.allocAndWrite(data);

    expect(ptr).toBe(4);
    expect(Array.from(heapU8.slice(4, 7))).toEqual([10, 20, 30]);
  });

  it('load fetches binary and delegates to instantiate', async () => {
    const arrayBuffer = new ArrayBuffer(16);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer),
    });
    vi.stubGlobal('fetch', fetchMock);
    const instantiateSpy = vi.spyOn(C64WASM.prototype, 'instantiate').mockResolvedValue();

    const wasm = await C64WASM.load('/roms/c64.wasm');

    expect(fetchMock).toHaveBeenCalledWith('/roms/c64.wasm');
    expect(instantiateSpy).toHaveBeenCalledWith(arrayBuffer);
    expect(wasm).toBeInstanceOf(C64WASM);
  });

  it('load throws when fetch is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(C64WASM.load('/missing.wasm')).rejects.toThrow('Failed to fetch /missing.wasm: 404');
  });
});

