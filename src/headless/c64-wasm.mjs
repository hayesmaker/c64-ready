// Minimal, plain-JS C64WASM wrapper used by the headless CLI.
// This is a direct JS translation of the TypeScript wrapper in
// src/emulator/c64-wasm.ts so the CLI can instantiate the WASM
// binary without requiring the compiled `dist-ts` artifact.

export class C64WASM {
  exports = null;
  heap = null;
  wasmMemory = null;

  static DYNAMICTOP_PTR = 5583504;
  static DYNAMIC_BASE = 10826544;
  static INITIAL_PAGES = 256;

  async instantiate(wasmBinary, extraEnv) {
    const mem = new WebAssembly.Memory({ initial: C64WASM.INITIAL_PAGES });
    this.wasmMemory = mem;

    const importObject = {
      env: { ...this.makeEnvImports(mem), ...(extraEnv ?? {}) },
      wasi_snapshot_preview1: this.makeWasiImports(mem),
    };

    try {
      const result = await WebAssembly.instantiate(wasmBinary, importObject);
      this.exports = result.instance.exports;
      this.updateHeapViews();

      // Initialise the sbrk heap pointer so malloc knows where free memory starts
      new DataView(mem.buffer).setUint32(C64WASM.DYNAMICTOP_PTR, C64WASM.DYNAMIC_BASE, true);

      if (this.exports.__wasm_call_ctors) this.exports.__wasm_call_ctors();
    } catch (err) {
      throw new Error(`WASM instantiation failed: ${err}`);
    }
  }

  allocAndWrite(data) {
    if (!this.exports || !this.heap) throw new Error('WASM not ready');
    const ptr = this.exports.malloc(data.length);
    // malloc may have grown memory, so refresh views before writing
    this.updateHeapViews();
    this.heap.heapU8.set(data, ptr);
    return ptr;
  }

  free(ptr) {
    if (this.exports && this.exports.free) this.exports.free(ptr);
  }

  updateHeapViews() {
    if (!this.wasmMemory) throw new Error('WASM memory not initialized');
    const buffer = this.wasmMemory.buffer;
    this.heap = {
      heapU8: new Uint8Array(buffer),
      heapF32: new Float32Array(buffer),
      heapU32: new Uint32Array(buffer),
    };
  }

  makeEnvImports(mem) {
    return {
      memory: mem,

      emscripten_get_sbrk_ptr: () => C64WASM.DYNAMICTOP_PTR,

      emscripten_resize_heap: (requestedSize) => {
        const PAGE_MULTIPLE = 65536;
        const maxHeapSize = 2147483648 - PAGE_MULTIPLE;
        if (requestedSize > maxHeapSize) return 0;

        const oldSize = mem.buffer.byteLength;
        const minHeapSize = 16777216;
        for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
          let overGrown = oldSize * (1 + 0.2 / cutDown);
          overGrown = Math.min(overGrown, requestedSize + 100663296);
          const newSize = Math.min(
            maxHeapSize,
            Math.ceil(Math.max(minHeapSize, requestedSize, overGrown) / PAGE_MULTIPLE) * PAGE_MULTIPLE,
          );
          try {
            mem.grow((newSize - mem.buffer.byteLength + 65535) >>> 16);
            this.updateHeapViews();
            return 1;
          } catch {
            // retry with less aggressive growth
          }
        }
        return 0;
      },

      emscripten_memcpy_big: (dest, src, num) => {
        new Uint8Array(mem.buffer).copyWithin(dest, src, src + num);
        return dest;
      },

      setTempRet0: (_val) => {},

      emscripten_asm_const_iii: (_code, _sig, _val) => 0,

      table: new WebAssembly.Table({ initial: 512, maximum: 512, element: 'anyfunc' }),
    };
  }

  makeWasiImports(mem) {
    return {
      fd_write: (fd, iovs, iovs_len, nwritten) => {
        const view = new DataView(mem.buffer);
        const u8 = new Uint8Array(mem.buffer);
        let written = 0;
        for (let i = 0; i < iovs_len; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          if (fd === 2) {
            const text = new TextDecoder().decode(u8.subarray(ptr, ptr + len));
            console.error(text);
          }
          written += len;
        }
        view.setUint32(nwritten, written, true);
        return 0;
      },
    };
  }
}

export default C64WASM;

