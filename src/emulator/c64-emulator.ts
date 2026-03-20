/**
 * C64Emulator — public interface for all emulator interactions.
 *
 * Responsibilities:
 * - Own the C64WASM instance and its lifecycle
 * - Expose clean, meaningful methods to frontend/headless consumers
 * - Manage emulation state (running, paused, frameCount)
 * - Fire onFrame / onAudio callbacks each tick
 *
 * Consumers (C64Player, C64Headless, Vue pages) use this class only.
 * They never touch C64WASM directly.
 */

import { C64WASM } from './c64-wasm';
import type { C64Config, FrameBuffer, AudioBuffer, GameLoadOptions, InputEvent } from '../types';

const FRAME_WIDTH  = 384;
const FRAME_HEIGHT = 272;
const DEFAULT_SAMPLE_RATE = 44100;

export class C64Emulator {
  private wasm: C64WASM;
  private config: C64Config;
  private running: boolean = false;
  private frameCount: number = 0;

  /** Called every tick with the latest video frame */
  onFrame?: (frame: FrameBuffer) => void;
  /** Called every tick with the latest audio samples */
  onAudio?: (audio: AudioBuffer) => void;

  private constructor(wasm: C64WASM, config: Partial<C64Config> = {}) {
    this.wasm = wasm;
    this.config = {
      videoWidth: FRAME_WIDTH,
      videoHeight: FRAME_HEIGHT,
      sampleRate: DEFAULT_SAMPLE_RATE,
      audioChannels: 1,
      cyclesPerFrame: 50,
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Main entry point for any consumer (browser page, headless server, tests).
   *
   * @example
   * const emulator = await C64Emulator.load();
   */
  static async load(
    wasmUrl: string = '/src/emulator/c64.wasm',
    config: Partial<C64Config> = {}
  ): Promise<C64Emulator> {
    const wasm = await C64WASM.load(wasmUrl);
    const emulator = new C64Emulator(wasm, config);
    emulator.init();
    console.log('C64 Emulator ready. RAM[0x0000] =', emulator.ramRead(0x0000));
    return emulator;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private init(): void {
    const x = this.wasm.exports;
    if (!x) throw new Error('WASM exports not available');
    x.c64_init();
  }

  start(): void  { this.running = true; }
  pause(): void  { this.running = false; }
  isRunning(): boolean { return this.running; }
  getFrameCount(): number { return this.frameCount; }

  reset(): void {
    this.wasm.exports?.c64_reset();
    this.frameCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Frame loop — call once per animation frame (requestAnimationFrame)
  // ---------------------------------------------------------------------------

  tick(dTime: number = 0): void {
    if (!this.running) return;
    const x = this.wasm.exports!;

    x.debugger_update(dTime);
    this.frameCount++;

    if (this.onFrame) {
      const ptr = x.c64_getPixelBuffer();
      const data = this.wasm.heap!.heapU8.subarray(ptr, ptr + FRAME_WIDTH * FRAME_HEIGHT * 4);
      this.onFrame({ width: FRAME_WIDTH, height: FRAME_HEIGHT, data, timestamp: this.frameCount });
    }

    if (this.onAudio) {
      const ptr = x.sid_getAudioBuffer();
      const len = x.sid_dumpBuffer();
      const samples = this.wasm.heap!.heapF32.subarray(ptr >> 2, (ptr >> 2) + len);
      this.onAudio({ sampleRate: this.config.sampleRate, channels: this.config.audioChannels, samples, timestamp: this.frameCount });
    }
  }

  // ---------------------------------------------------------------------------
  // Game loading
  // ---------------------------------------------------------------------------

  loadGame(options: GameLoadOptions): void {
    const x = this.wasm.exports;
    if (!x || !this.wasm.heap) throw new Error('WASM not ready');

    const ptr = this.wasm.allocAndWrite(options.data);
    try {
      switch (options.type) {
        case 'prg':      x.c64_loadPRG(ptr, options.data.length); break;
        case 'd64':      x.c64_insertDisk(ptr, options.data.length); break;
        case 'crt':      x.c64_loadCartridge(ptr, options.data.length); break;
        case 'snapshot': x.c64_loadSnapshot(ptr, options.data.length); break;
      }
    } finally {
      this.wasm.free(ptr);
    }
  }

  removeCartridge(): void { this.wasm.exports?.c64_removeCartridge(); }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  handleInput(event: InputEvent): void {
    const x = this.wasm.exports;
    if (!x) return;

    if (event.type === 'key' && event.key !== undefined) {
      x.keyboard_keyPressed(Number(event.key));
    } else if (event.type === 'joystick') {
      const port = (event.joystickPort ?? 1) - 1;  // callers use 1/2, WASM uses 0/1
      const dirMap: Record<string, number> = { up: 1, down: 2, left: 4, right: 8 };
      if (event.direction) x.c64_joystick_push(port, dirMap[event.direction] ?? 0);
      if (event.fire1)     x.c64_joystick_push(port, 16);
    }
  }

  keyDown(keyCode: number): void  { this.wasm.exports?.keyboard_keyPressed(keyCode); }
  keyUp(keyCode: number): void    { this.wasm.exports?.keyboard_keyReleased(keyCode); }

  /** @param port 1-based joystick port (1 or 2) */
  joystickPush(port: number, dir: number): void    { this.wasm.exports?.c64_joystick_push(port - 1, dir); }
  /** @param port 1-based joystick port (1 or 2) */
  joystickRelease(port: number, dir: number): void { this.wasm.exports?.c64_joystick_release(port - 1, dir); }
  mousePosition(x: number, y: number): void        { this.wasm.exports?.c64_mouse_position(x, y); }

  // ---------------------------------------------------------------------------
  // Memory access
  // ---------------------------------------------------------------------------

  ramRead(addr: number): number  { return this.wasm.exports?.c64_ramRead(addr) ?? 0; }
  ramWrite(addr: number, v: number): void { this.wasm.exports?.c64_ramWrite(addr, v); }
  cpuRead(addr: number): number  { return this.wasm.exports?.c64_cpuRead(addr) ?? 0; }
  cpuWrite(addr: number, v: number): void { this.wasm.exports?.c64_cpuWrite(addr, v); }

  // ---------------------------------------------------------------------------
  // CPU state
  // ---------------------------------------------------------------------------

  getPC(): number  { return this.wasm.exports?.c64_getPC() ?? 0; }
  getRegA(): number { return this.wasm.exports?.c64_getRegA() ?? 0; }
  getRegX(): number { return this.wasm.exports?.c64_getRegX() ?? 0; }
  getRegY(): number { return this.wasm.exports?.c64_getRegY() ?? 0; }
  getSP(): number  { return this.wasm.exports?.c64_getSP() ?? 0; }
  getCycleCount(): number { return this.wasm.exports?.c64_getCycleCount() ?? 0; }

  // ---------------------------------------------------------------------------
  // Video
  // ---------------------------------------------------------------------------

  getFrameBuffer(): FrameBuffer {
    if (!this.wasm.exports || !this.wasm.heap) throw new Error('WASM not ready');
    const ptr = this.wasm.exports.c64_getPixelBuffer();
    const data = this.wasm.heap.heapU8.slice(ptr, ptr + FRAME_WIDTH * FRAME_HEIGHT * 4);
    return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data, timestamp: this.frameCount };
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  getSnapshot(): Uint8Array {
    const x = this.wasm.exports;
    if (!x || !this.wasm.heap) throw new Error('WASM not ready');
    const size = x.c64_getSnapshotSize();
    const ptr = x.malloc(size);
    x.c64_getSnapshot(ptr);
    const snap = this.wasm.heap.heapU8.slice(ptr, ptr + size);
    x.free(ptr);
    return snap;
  }

  // ---------------------------------------------------------------------------
  // Debugger
  // ---------------------------------------------------------------------------

  debuggerPause(): void   { this.wasm.exports?.debugger_pause(); }
  debuggerPlay(): void    { this.wasm.exports?.debugger_play(); }
  debuggerStep(): void    { this.wasm.exports?.debugger_step(); }
  debuggerIsRunning(): boolean { return (this.wasm.exports?.debugger_isRunning() ?? 0) !== 0; }
  setDebugSpeed(speed: number): void { this.wasm.exports?.debugger_set_speed(speed); }

  // ---------------------------------------------------------------------------
  // Audio / SID
  // ---------------------------------------------------------------------------

  setSampleRate(rate: number): void  { this.wasm.exports?.sid_setSampleRate(rate); }
  setSIDModel(model: number): void   { this.wasm.exports?.sid_setModel(model); }
  setVoiceEnabled(voice: number, enabled: boolean): void {
    this.wasm.exports?.sid_setVoiceEnabled(enabled ? voice : 0);
  }

  // ---------------------------------------------------------------------------
  // Drive
  // ---------------------------------------------------------------------------

  setDriveEnabled(enabled: boolean): void { this.wasm.exports?.c64_setDriveEnabled(enabled ? 1 : 0); }
  getDriveEnabled(): boolean { return (this.wasm.exports?.c64_getDriveEnabled() ?? 0) !== 0; }
}
