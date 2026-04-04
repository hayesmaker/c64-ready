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

  // Emscripten layout constants (must match the compiled binary)
  private static readonly DYNAMICTOP_PTR = 5583504;
  private static readonly DYNAMIC_BASE = 10826544;
  private static readonly INITIAL_PAGES = 256; // 16 MB

  async instantiate(wasmBinary: ArrayBuffer, extraEnv?: Record<string, unknown>): Promise<void> {
    const mem = new WebAssembly.Memory({ initial: C64WASM.INITIAL_PAGES });
    this.wasmMemory = mem;

    const importObject = {
      env: { ...this.makeEnvImports(mem), ...(extraEnv ?? {}) },
      wasi_snapshot_preview1: this.makeWasiImports(mem),
    };

    try {
      const result = await WebAssembly.instantiate(wasmBinary, importObject);
      this.exports = result.instance.exports as unknown as WASMExports;
      this.updateHeapViews();

      // Initialise the sbrk heap pointer so malloc knows where free memory starts
      new DataView(mem.buffer).setUint32(C64WASM.DYNAMICTOP_PTR, C64WASM.DYNAMIC_BASE, true);

      this.exports.__wasm_call_ctors();
    } catch (err) {
      throw new Error(`WASM instantiation failed: ${err}`, { cause: err });
    }
  }

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  /** Allocate a buffer in WASM heap, write data, return pointer */
  allocAndWrite(data: Uint8Array): number {
    if (!this.exports || !this.heap) throw new Error('WASM not ready');
    const ptr = this.exports.malloc(data.length);
    // malloc may have grown memory, so refresh views before writing
    this.updateHeapViews();
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

      emscripten_get_sbrk_ptr: (): number => C64WASM.DYNAMICTOP_PTR,

      emscripten_resize_heap: (requestedSize: number): number => {
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
            Math.ceil(Math.max(minHeapSize, requestedSize, overGrown) / PAGE_MULTIPLE) *
              PAGE_MULTIPLE,
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

  /**
   * Line-buffer for stdout (fd 1) printf output from the WASM C core.
   * Accumulated character-by-character; flushed on newline or null byte.
   * Kept as a Uint8Array buffer to match the printChar pattern from c64.js.
   */
  private stdoutBuf: number[] = [];

  /**
   * Patterns emitted by the C64 ROM/cartridge loader that we want to surface.
   * Examples seen in practice:
   *   "magic desk cartridge"
   *   "normal cartridge"
   *   "easy flash cartridge"
   *   "read magic desk bank count = 10"
   *   "bank 0"  "bank 1"  ...
   */
  private static readonly CART_LOG_PATTERNS = [
    /cartri?dge/i,         // cartridge type announcements
    /bank\s*\d+/i,         // bank loading ("bank 0", "bank 1", …)
    /bank\s*count/i,       // "read magic desk bank count = N"
    /read\s+magic/i,       // "read magic desk …"
    /easy\s*flash/i,       // EasyFlash-specific lines
    /crt\b/i,              // generic CRT-related lines
  ];

  /** Flush the accumulated stdout line to console if it matches cart patterns */
  private flushStdoutLine(): void {
    if (this.stdoutBuf.length === 0) return;
    const line = new TextDecoder().decode(new Uint8Array(this.stdoutBuf)).trim();
    this.stdoutBuf = [];
    if (!line) return;

    const isCartLine = C64WASM.CART_LOG_PATTERNS.some((re) => re.test(line));
    if (isCartLine) {
      console.log('[C64 cart]', line);
    }
  }

  private makeWasiImports(mem: WebAssembly.Memory) {
    return {
      fd_write: (fd: number, iovs: number, iovs_len: number, nwritten: number): number => {
        const view = new DataView(mem.buffer);
        const u8 = new Uint8Array(mem.buffer);
        let written = 0;
        for (let i = 0; i < iovs_len; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);

          if (fd === 1) {
            // stdout — accumulate into line buffer, flush on newline/null.
            // This surfaces cartridge loading diagnostics (type, bank count,
            // bank-by-bank progress) while suppressing the noisy per-frame
            // SID/timing output.
            for (let j = 0; j < len; j++) {
              const ch = u8[ptr + j];
              if (ch === 0 || ch === 10 /* '\n' */) {
                this.flushStdoutLine();
              } else {
                this.stdoutBuf.push(ch);
              }
            }
          } else if (fd === 2) {
            // stderr — forward verbatim to console.error
            const text = new TextDecoder().decode(u8.subarray(ptr, ptr + len));
            console.error('[C64 stderr]', text);
          }

          written += len;
        }
        view.setUint32(nwritten, written, true);
        return 0;
      },
    };
  }
}
