# C64 Emulator TypeScript Rewrite (V2 Plan)

## Overview
Rewrite the 5800-line c64.js into a clean, modular TypeScript architecture while keeping the existing 
WebAssembly binary. This produces a maintainable codebase suitable for streaming, 
multi-player, and future extensions.

## Rationale
- Current c64.js is monolithic, hard to hook, and couples browser UI with emulation logic
- TypeScript provides type safety and IDE support
- Modular design enables headless operation, testing, and feature additions
- Existing WASM binary (the CPU/chipset logic) stays unchanged — we're only rewriting the glue layer

## High-Level Architecture
```
┌─────────────────────────────────────────────────┐
│         Application Layer (Vue.js)              │
│  (existing frontend, calls C64Player)           │
└─────────┬───────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│     C64Player (Browser UI + Input)              │
│  ├─ CanvasRenderer                              │
│  ├─ AudioEngine (Web Audio API)                 │
│  └─ InputHandler (Keyboard/Joystick)            │
└─────────┬───────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│      C64Emulator (Core Logic)                   │
│  ├─ C64WASM (wrapper around .wasm binary)       │
│  ├─ Memory (heap management)                    │
│  └─ Constants (addresses, opcodes, etc)         │
└─────────┬───────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│  WebAssembly Binary (CPU, Chipsets, ROM)        │
│  (unchanged from current c64.wasm)              │
└─────────────────────────────────────────────────┘
```
Headless variant replaces CanvasRenderer/AudioEngine/InputHandler with:

```
┌─────────────────────────────────┐
│    C64Headless (Streaming)      │
│  ├─ FrameCapture                │
│  ├─ AudioCapture                │
│  └─ RemoteInputBridge           │
└──────────┬──────────────────────┘
           │
        [Node.js]
           │
    FFmpeg / WebSocket
```

## File Structure

```
src/
├── types/
│   ├── index.ts                 # Shared interfaces and types
│   └── emulator.ts              # C64 state types
│
├── emulator/
│   ├── c64-wasm.ts              # Low-level WASM wrapper
│   ├── c64-emulator.ts          # High-level emulator API
│   ├── memory.ts                # Heap/memory management
│   ├── constants.ts             # Addresses, timings, opcodes
│   └── input.ts                 # Joystick/keyboard constants
│
├── player/
│   ├── c64-player.ts            # Main player class (browser)
│   ├── canvas-renderer.ts       # Canvas drawing
│   ├── audio-engine.ts          # Web Audio API wrapper
│   ├── input-handler.ts         # Keyboard/gamepad input
│   └── ui-controller.ts         # UI state (pause, volume, etc)
│
├── headless/
│   ├── c64-headless.ts          # Headless variant (no DOM)
│   ├── frame-capture.ts         # Frame buffer capture
│   ├── audio-capture.ts         # Audio sample capture
│   ├── input-bridge.ts          # Remote input (WebSocket)
│   └── ffmpeg-runner.ts         # FFmpeg spawning/piping
│
└── index.ts                     # Main exports
```

## Detailed Module Specs

### 1. types/index.ts

```typescript
/**
 * Shared types and interfaces for C64 emulator
 */

export interface C64State {
  running: boolean;
  paused: boolean;
  frameCount: number;
  cycleCount: number;
}

export interface FrameBuffer {
  width: number;
  height: number;
  data: Uint8Array; // RGBA pixels
  timestamp: number;
}

export interface AudioBuffer {
  sampleRate: number;
  channels: number;
  samples: Float32Array;
  timestamp: number;
}

export interface InputEvent {
  type: 'key' | 'joystick';
  key?: string;
  joystickPort?: 1 | 2;
  direction?: 'up' | 'down' | 'left' | 'right';
  fire1?: boolean;
  fire2?: boolean;
}

export interface GameLoadOptions {
  type: 'prg' | 'd64' | 'crt' | 'snapshot';
  data: Uint8Array;
  autoRun?: boolean;
}

export interface C64Config {
  videoWidth: number;
  videoHeight: number;
  sampleRate: number;
  audioChannels: number;
  cyclesPerFrame: number; // ~50 FPS PAL
}
```

### 2. types/emulator.ts
```typescript
/**
 * Low-level emulator state and function signatures
 */

export interface WASMExports {
  memory: WebAssembly.Memory;
  
  // Core stepping
  tick(): void;
  reset(): void;
  
  // Memory access
  getPixelBuffer(): number; // ptr to RGBA framebuffer
  getAudioBuffer(): number; // ptr to float32 audio samples
  
  // Input
  keyDown(keyCode: number): void;
  keyUp(keyCode: number): void;
  joystickSetDirection(port: number, dir: number): void;
  joystickSetFire(port: number, fire: boolean): void;
  
  // Game loading
  loadPRG(ptr: number, len: number, inject: boolean): void;
  loadD64(ptr: number, len: number): void;
  loadCRT(ptr: number, len: number): void;
  loadSnapshot(ptr: number, len: number): void;
  
  // Query
  getSampleRate(): number;
  getAudioBufferLength(): number;
}

export interface WASMMemory {
  heapU8: Uint8Array;
  heapF32: Float32Array;
  heapU32: Uint32Array;
}
```

### 3. emulator/c64-wasm.ts
```typescript
/**
 * Low-level wrapper around WebAssembly C64 binary
 * Handles:
 * - WASM module instantiation
 * - Memory views (heap access)
 * - Function invocation
 * - Pointer arithmetic
 */

import type { WASMExports, WASMMemory } from '../types/emulator';

export class C64WASM {
  private wasm: WASMExports | null = null;
  private memory: WASMMemory | null = null;
  
  /**
   * Load and instantiate the WASM binary
   * @param wasmBinary ArrayBuffer containing compiled WASM
   * @param imports Object with env imports (memory, functions, etc)
   */
  async instantiate(
    wasmBinary: ArrayBuffer,
    imports?: Record<string, any>
  ): Promise<void> {
    const importObject = {
      env: imports || {},
      wasi_snapshot_preview1: {}, // minimal WASI support
    };

    try {
      const result = await WebAssembly.instantiate(
        wasmBinary,
        importObject
      );
      this.wasm = result.instance.exports as unknown as WASMExports;
      this.updateMemoryViews();
    } catch (err) {
      throw new Error(`WASM instantiation failed: ${err}`);
    }
  }

  /**
   * Update memory views after instantiation or memory growth
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
```

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
    if (!this.running) return;

    // Tick emulator once
    this.wasm.tick();
    this.frameCount++;

    // Capture frame
    const frameData = this.wasm.getFrameBuffer();
    if (this.onFrame) {
      this.onFrame({
        width: this.config.videoWidth,
        height: this.config.videoHeight,
        data: frameData,
        timestamp: this.frameCount,
      });
    }

    // Capture audio
    const audioLen = this.wasm.getAudioBufferLength();
    const audioData = this.wasm.getAudioBuffer(audioLen);
    if (this.onAudio) {
      this.onAudio({
        sampleRate: this.config.sampleRate,
        channels: this.config.audioChannels,
        samples: audioData,
        timestamp: this.frameCount,
      });
    }
  }

  /**
   * Start emulation loop
   */
  start(): void {
    this.running = true;
  }

  /**
   * Pause emulation
   */
  pause(): void {
    this.running = false;
  }

  /**
   * Reset emulator
   */
  reset(): void {
    this.wasm.reset();
    this.frameCount = 0;
  }

  /**
   * Load a game
   */
  async loadGame(options: GameLoadOptions): Promise<void> {
    switch (options.type) {
      case 'prg':
        this.wasm.loadPRG(options.data, options.autoRun ?? false);
        break;
      case 'd64':
        this.wasm.loadD64(options.data);
        break;
      case 'crt':
        this.wasm.loadCRT(options.data);
        break;
      case 'snapshot':
        this.wasm.loadSnapshot(options.data);
        break;
    }
  }

  /**
   * Handle input event
   */
  handleInput(event: InputEvent): void {
    if (event.type === 'key') {
      // Map key string to C64 keycode
      const keyCode = KeyCodes[event.key] ?? 0;
      this.wasm.keyDown(keyCode);
    } else if (event.type === 'joystick') {
      const port = event.joystickPort ?? 1;
      if (event.direction) {
        const dirMap = { up: 1, down: 2, left: 4, right: 8 };
        this.wasm.joystickSetDirection(port, dirMap[event.direction]);
      }
      if (event.fire !== undefined) {
        this.wasm.joystickSetFire(port, event.fire);
      }
    }
  }

  getFrameCount(): number {
    return this.frameCount;
  }

  isRunning(): boolean {
    return this.running;
  }
}
```

### 6. headless/c64-headless.ts
```typescript
/**
 * Headless C64 emulator for server-side streaming
 * No DOM, no Web Audio API — just emulation + frame/audio capture
 */

import { C64Emulator } from '../emulator/c64-emulator';
import { FrameCapture } from './frame-capture';
import { AudioCapture } from './audio-capture';
import { InputBridge } from './input-bridge';
import type { GameLoadOptions, FrameBuffer, AudioBuffer } from '../types';

export class C64Headless {
  private emulator: C64Emulator;
  private frameCapture: FrameCapture;
  private audioCapture: AudioCapture;
  private inputBridge: InputBridge;

  constructor(wasmBinary: ArrayBuffer, config?: any) {
    this.emulator = new C64Emulator(wasmBinary, config);
    this.frameCapture = new FrameCapture();
    this.audioCapture = new AudioCapture();
    this.inputBridge = new InputBridge();

    // Wire callbacks
    this.emulator.onFrame = (frame: FrameBuffer) => {
      this.frameCapture.capture(frame);
    };

    this.emulator.onAudio = (audio: AudioBuffer) => {
      this.audioCapture.capture(audio);
    };

    this.inputBridge.onInput = (event) => {
      this.emulator.handleInput(event);
    };
  }

  async init(wasmBinary: ArrayBuffer): Promise<void> {
    await this.emulator.init(wasmBinary);
  }

  async loadGame(options: GameLoadOptions): Promise<void> {
    await this.emulator.loadGame(options);
  }

  /**
   * Run emulator for one frame and return captured data
   */
  stepAndCapture(): { frame?: Uint8Array; audio?: Float32Array } {
    this.emulator.step();
    return {
      frame: this.frameCapture.getLatest(),
      audio: this.audioCapture.getLatest(),
    };
  }

  /**
   * Continuous run loop (for streaming server)
   */
  async runLoop(onFrame?: (data: Uint8Array) => void, onAudio?: (data: Float32Array) => void): Promise<void> {
    this.emulator.start();
    while (this.emulator.isRunning()) {
      const { frame, audio } = this.stepAndCapture();
      if (frame && onFrame) onFrame(frame);
      if (audio && onAudio) onAudio(audio);
      // Control frame rate (yield to event loop)
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  /**
   * Inject input (from WebSocket or remote)
   */
  feedInput(inputJson: string): void {
    const event = JSON.parse(inputJson);
    this.emulator.handleInput(event);
  }

  stop(): void {
    this.emulator.pause();
  }
}
```

### 7. headless/frame-capture.ts
```typescript
/**
 * Frame capture for headless operation
 */

import type { FrameBuffer } from '../types';

export class FrameCapture {
  private latestFrame: Uint8Array | null = null;
  private frameQueue: Uint8Array[] = [];

  capture(frame: FrameBuffer): void {
    // Store latest frame
    this.latestFrame = frame.data;
    // Optionally queue for batch processing
    this.frameQueue.push(frame.data);
  }

  getLatest(): Uint8Array | null {
    return this.latestFrame;
  }

  getQueued(): Uint8Array[] {
    const q = this.frameQueue;
    this.frameQueue = [];
    return q;
  }

  clearQueue(): void {
    this.frameQueue = [];
  }
}
```
### 8. headless/audio-capture.ts
```typescript
/**
 * Audio capture for headless operation
 */

import type { AudioBuffer } from '../types';

export class AudioCapture {
  private latestAudio: Float32Array | null = null;
  private audioQueue: Float32Array[] = [];

  capture(audio: AudioBuffer): void {
    // Store latest samples
    this.latestAudio = audio.samples;
    // Queue for batch processing
    this.audioQueue.push(audio.samples);
  }

  getLatest(): Float32Array | null {
    return this.latestAudio;
  }

  getQueued(): Float32Array[] {
    const q = this.audioQueue;
    this.audioQueue = [];
    return q;
  }

  clearQueue(): void {
    this.audioQueue = [];
  }
}
```
### 9. headless/input-bridge.ts
```typescript
/**
 * Remote input bridge (WebSocket → emulator)
 * Allows remote players to control the emulator
 */

import type { InputEvent } from '../types';

export class InputBridge {
  onInput?: (event: InputEvent) => void;

  /**
   * Called when a remote input arrives (e.g., from WebSocket)
   */
  receiveRemoteInput(jsonString: string): void {
    try {
      const event: InputEvent = JSON.parse(jsonString);
      if (this.onInput) {
        this.onInput(event);
      }
    } catch (err) {
      console.error('Failed to parse input:', err);
    }
  }

  /**
   * Example: encode a keypress for transmission
   */
  static encodeKeypress(key: string): string {
    return JSON.stringify({ type: 'key', key });
  }

  static encodeJoystick(
    port: 1 | 2,
    direction?: string,
    fire?: boolean
  ): string {
    return JSON.stringify({
      type: 'joystick',
      joystickPort: port,
      direction,
      fire,
    });
  }
}
```

