/**
 * Low-level wrapper around the C64 WebAssembly binary (Emscripten-compiled)
 *
 * Responsibilities:
 * - Fetch and instantiate the WASM binary
 * - Provide the Emscripten/WASI imports the binary requires
 * - Manage WebAssembly.Memory and keep heap views up to date
 * - Forward raw WASM export calls to C64Emulator
 *
 * NOT responsible for: game logic, input handling, frame loop, or UI.
 * Consumers should use C64Emulator, not this class directly.
 */

import type { WASMExports } from '../types/emulator';

export interface HeapViews {
  heapU8: Uint8Array;
  heapF32: Float32Array;
  heapU32: Uint32Array;
}

export class C64WASM {
  /** Raw WASM exports — available to C64Emulator */
  exports: WASMExports | null = null;

  /** Typed views into WASM linear memory */
  heap: HeapViews | null = null;

  private wasmMemory: WebAssembly.Memory | null = null;

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  /**
   * Fetch, instantiate and initialise the WASM binary.
   * C64Emulator calls this via the static C64Emulator.load() factory.
   */
  static async load(wasmUrl: string = '/src/emulator/c64.wasm'): Promise<C64WASM> {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Failed to fetch ${wasmUrl}: ${response.status}`);
    const binary = await response.arrayBuffer();
    const instance = new C64WASM();
    await instance.instantiate(binary);
    return instance;
  }

  async instantiate(wasmBinary: ArrayBuffer, extraEnv?: Record<string, any>): Promise<void> {
    const mem = new WebAssembly.Memory({ initial: 256, maximum: 512 });
    this.wasmMemory = mem;

    const importObject = {
      env: { ...this.makeEnvImports(mem), ...(extraEnv ?? {}) },
      wasi_snapshot_preview1: this.makeWasiImports(mem),
    };

    try {
      const result = await WebAssembly.instantiate(wasmBinary, importObject);
      this.exports = result.instance.exports as unknown as WASMExports;
      this.updateHeapViews();
      this.exports.__wasm_call_ctors();
    } catch (err) {
      throw new Error(`WASM instantiation failed: ${err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  /** Allocate a buffer in WASM heap, write data, return pointer */
  allocAndWrite(data: Uint8Array): number {
    if (!this.exports || !this.heap) throw new Error('WASM not ready');
    const ptr = this.exports.malloc(data.length);
    this.heap.heapU8.set(data, ptr);
    return ptr;
  }

  free(ptr: number): void {
    this.exports?.free(ptr);
  }

  /** Refresh heap views — must be called after any memory.grow() */
  updateHeapViews(): void {
    if (!this.wasmMemory) throw new Error('WASM memory not initialized');
    const buffer = this.wasmMemory.buffer;
    this.heap = {
      heapU8: new Uint8Array(buffer),
      heapF32: new Float32Array(buffer),
      heapU32: new Uint32Array(buffer),
    };
  }

  // ---------------------------------------------------------------------------
  // Emscripten env imports
  // ---------------------------------------------------------------------------

  private makeEnvImports(mem: WebAssembly.Memory) {
    return {
      memory: mem,

      emscripten_resize_heap: (requestedSize: number): number => {
        const currentPages = mem.buffer.byteLength / 65536;
        const neededPages = Math.ceil(requestedSize / 65536);
        const delta = neededPages - currentPages;
        try {
          mem.grow(delta > 0 ? delta : 1);
          this.updateHeapViews();
          return 1;
        } catch {
          return 0;
        }
      },

      emscripten_memcpy_big: (dest: number, src: number, num: number): number => {
        new Uint8Array(mem.buffer).copyWithin(dest, src, src + num);
        return dest;
      },

      setTempRet0: (_val: number): void => {},

      emscripten_asm_const_iii: (_code: number, _sig: number, _val: number): number => 0,

      table: new WebAssembly.Table({ initial: 512, maximum: 512, element: 'anyfunc' }),
    };
  }

  // ---------------------------------------------------------------------------
  // WASI imports (only fd_write is used by this binary)
  // ---------------------------------------------------------------------------

  private makeWasiImports(mem: WebAssembly.Memory) {
    return {
      fd_write: (fd: number, iovs: number, iovs_len: number, nwritten: number): number => {
        const view = new DataView(mem.buffer);
        const u8 = new Uint8Array(mem.buffer);
        let written = 0;
        for (let i = 0; i < iovs_len; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          if (fd === 1 || fd === 2) {
            const text = new TextDecoder().decode(u8.subarray(ptr, ptr + len));
            fd === 1 ? console.log(text) : console.error(text);
          }
          written += len;
        }
        view.setUint32(nwritten, written, true);
        return 0;
      },
    };
  }
}