// Copied from repository root REWRITE_PLAN_V2..md
This plan has been superseded. The current, trimmed project overview has been moved to `PROJECT_OVERVIEW.md` at the repository root.

Please see `PROJECT_OVERVIEW.md` for the updated architecture, implemented components, and future work list. The original, very detailed plan (with code examples) has been archived in the repository history and the `temp/` folder (the large `c64.js` reference is kept there for offline reference).

   */
  private updateMemoryViews(): void {
    if (!this.wasm) throw new Error('WASM not instantiated');

    const buffer = this.wasm.memory.buffer;
    this.memory = {
      heapU8: new Uint8Array(buffer),
      heapF32: new Float32Array(buffer),
      heapU32: new Uint32Array(buffer),
    };
  }

  /**
   * Read a byte from emulator memory
   */
  readU8(addr: number): number {
    if (!this.memory) throw new Error('Memory not initialized');
    return this.memory.heapU8[addr];
  }

  /**
   * Write a byte to emulator memory
   */
  writeU8(addr: number, value: number): void {
    if (!this.memory) throw new Error('Memory not initialized');
    this.memory.heapU8[addr] = value;
  }

  /**
   * Read a 32-bit value from emulator memory
   */
  readU32(addr: number): number {
    if (!this.memory) throw new Error('Memory not initialized');
    return this.memory.heapU32[addr >> 2];
  }

  /**
   * Get the pixel framebuffer from WASM
   * Returns a view into emulator's VRAM as RGBA bytes
   */
  getFrameBuffer(): Uint8Array {
    if (!this.wasm || !this.memory) throw new Error('WASM not ready');
    const ptr = this.wasm.getPixelBuffer();
    const len = 384 * 272 * 4; // hardcoded for now; could query
    return this.memory.heapU8.slice(ptr, ptr + len);
  }

  /**
   * Get the audio sample buffer from WASM
   * Returns a view into emulator's audio output as Float32
   */
  getAudioBuffer(length: number): Float32Array {
    if (!this.wasm || !this.memory) throw new Error('WASM not ready');
    const ptr = this.wasm.getAudioBuffer();
    return this.memory.heapF32.slice(ptr >> 2, (ptr >> 2) + length);
  }

  /**
   * Step emulator by one frame
   */
  tick(): void {
    if (!this.wasm) throw new Error('WASM not instantiated');
    this.wasm.tick();
  }

  /**
   * Reset emulator
   */
  reset(): void {
    if (!this.wasm) throw new Error('WASM not instantiated');
    this.wasm.reset();
  }

  // Input methods
  keyDown(keyCode: number): void {
    if (!this.wasm) throw new Error('WASM not instantiated');
    this.wasm.keyDown(keyCode);
  }

  keyUp(keyCode: number): void {
    if (!this.wasm) throw new Error('WASM not instantiated');
    this.wasm.keyUp(keyCode);
  }

  joystickSetDirection(port: 1 | 2, dir: number): void {
    if (!this.wasm) throw new Error('WASM not instantiated');
    this.wasm.joystickSetDirection(port, dir);
  }

  joystickSetFire(port: 1 | 2, fire: boolean): void {
    if (!this.wasm) throw new Error('WASM not instantiated');
    this.wasm.joystickSetFire(port, fire ? 1 : 0);
  }

  // Game loading methods
  loadPRG(data: Uint8Array, inject: boolean = false): void {
    if (!this.wasm || !this.memory) throw new Error('WASM not ready');
    const ptr = this.allocateBuffer(data.length);
    this.memory.heapU8.set(data, ptr);
    this.wasm.loadPRG(ptr, data.length, inject ? 1 : 0);
  }

  loadD64(data: Uint8Array): void {
    if (!this.wasm || !this.memory) throw new Error('WASM not ready');
    const ptr = this.allocateBuffer(data.length);
    this.memory.heapU8.set(data, ptr);
    this.wasm.loadD64(ptr, data.length);
  }

  loadCRT(data: Uint8Array): void {
    if (!this.wasm || !this.memory) throw new Error('WASM not ready');
    const ptr = this.allocateBuffer(data.length);
    this.memory.heapU8.set(data, ptr);
    this.wasm.loadCRT(ptr, data.length);
  }

  loadSnapshot(data: Uint8Array): void {
    if (!this.wasm || !this.memory) throw new Error('WASM not ready');
    const ptr = this.allocateBuffer(data.length);
    this.memory.heapU8.set(data, ptr);
    this.wasm.loadSnapshot(ptr, data.length);
  }

  /**
   * Simple malloc-style allocation
   * In production, use proper heap management
   */
  private allocateBuffer(size: number): number {
    // Placeholder: in real implementation, use a proper allocator
    // For now, assume a fixed heap region for game data
    return 0x10000; // arbitrary high address
  }

  /**
   * Get audio sample rate (may vary)
   */
  getSampleRate(): number {
    if (!this.wasm) throw new Error('WASM not instantiated');
    return this.wasm.getSampleRate();
  }

  /**
   * Get audio buffer length for this tick
   */
  getAudioBufferLength(): number {
    if (!this.wasm) throw new Error('WASM not instantiated');
    return this.wasm.getAudioBufferLength();
  }
}

### 4. emulator/c64-emulator.ts
```typescript
/**
 * High-level C64 emulator API
 * Orchestrates WASM, memory, and state management
 */

import { C64WASM } from './c64-wasm';
import type { C64Config, FrameBuffer, AudioBuffer, GameLoadOptions, InputEvent } from '../types';
import { KeyCodes } from './constants';

export class C64Emulator {
  private wasm: C64WASM;
  private config: C64Config;
  private running: boolean = false;
  private frameCount: number = 0;

  // Callbacks for frame/audio capture (used in headless mode)
  onFrame?: (frame: FrameBuffer) => void;
  onAudio?: (audio: AudioBuffer) => void;

  constructor(wasmBinary: ArrayBuffer, config: Partial<C64Config> = {}) {
    this.wasm = new C64WASM();
    this.config = {
      videoWidth: 384,
      videoHeight: 272,
      sampleRate: 44100,
      audioChannels: 1,
      cyclesPerFrame: 50, // PAL
      ...config,
    };
  }

  /**
   * Initialize the emulator
   */
  async init(wasmBinary: ArrayBuffer): Promise<void> {
    await this.wasm.instantiate(wasmBinary);
  }

  /**
   * Run the emulator for one frame
   * Captures video and audio, invokes callbacks
   */
  step(): void {

