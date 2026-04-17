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
import { getUnsupportedCrtReason, parseCrtInfo } from './crt-info';
import type { C64Config, FrameBuffer, AudioBuffer, GameLoadOptions, InputEvent } from '../types';
import type { JoystickPort, JoystickInput } from './constants';

const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 272;
const DEFAULT_SAMPLE_RATE = 44100;

export class C64Emulator {
  private wasm: C64WASM;
  private readonly wasmUrl: string;
  private config: C64Config;
  private running: boolean = false;
  private frameCount: number = 0;
  private crtPreloadChecksEnabled: boolean = true;

  /** Called every tick with the latest video frame */
  onFrame?: (frame: FrameBuffer) => void;
  /** Called every tick with the latest audio samples */
  onAudio?: (audio: AudioBuffer) => void;

  private constructor(wasm: C64WASM, wasmUrl: string, config: Partial<C64Config> = {}) {
    this.wasm = wasm;
    this.wasmUrl = wasmUrl;
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
    config: Partial<C64Config> = {},
  ): Promise<C64Emulator> {
    const wasm = await C64WASM.load(wasmUrl);
    const emulator = new C64Emulator(wasm, wasmUrl, config);
    emulator.init();
    return emulator;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private init(): void {
    const x = this.wasm.exports;
    if (!x) throw new Error('WASM exports not available');
    x.c64_init();
    // Reference config to avoid unused-private-field warnings in TS and
    // ensure sample rate is applied on init. Guard calls in case the
    // underlying WASM exports don't provide the SID helper (tests/fake
    // instantiations may omit it).
    if (this.config.sampleRate) {
      const fn = (this.wasm.exports as unknown as { sid_setSampleRate?: (rate: number) => unknown })
        .sid_setSampleRate;
      if (typeof fn === 'function') fn(this.config.sampleRate);
    }
  }

  start(): void {
    this.running = true;
  }
  pause(): void {
    this.running = false;
  }
  isRunning(): boolean {
    return this.running;
  }
  getFrameCount(): number {
    return this.frameCount;
  }

  reset(): void {
    this.wasm.exports?.c64_reset();
    this.frameCount = 0;
  }

  async reboot(): Promise<void> {
    const wasRunning = this.running;
    const nextWasm = await C64WASM.load(this.wasmUrl);

    this.running = false;
    this.wasm = nextWasm;
    this.frameCount = 0;
    this.init();

    if (wasRunning) {
      this.start();
    }
  }

  setCrtPreloadChecksEnabled(enabled: boolean): void {
    this.crtPreloadChecksEnabled = enabled;
  }

  // ---------------------------------------------------------------------------
  // Frame loop — call once per animation frame (requestAnimationFrame)
  // ---------------------------------------------------------------------------

  /**
   * The SID continuously fills a circular audio buffer as CPU cycles execute.
   * Must match the ScriptProcessorNode buffer length used by the original
   * c64.js runtime (4096 samples).
   */
  private static readonly AUDIO_BUFFER_SIZE = 4096;

  tick(dTime: number = 0): void {
    if (!this.running) return;
    const x = this.wasm.exports!;

    // Clamp dTime exactly like the original c64.js render loop:
    // if dTime is 0 or > 100 ms, lock to ~60 fps to prevent runaway cycles.
    // if (!dTime || dTime > 100) {
    //   dTime = 1000 / 60;
    // }

    const updated = x.debugger_update(dTime);
    this.frameCount++;

    // Only push a video frame when the emulator actually advanced
    if (updated && this.onFrame) {
      const ptr = x.c64_getPixelBuffer();
      const data = this.wasm.heap!.heapU8.subarray(ptr, ptr + FRAME_WIDTH * FRAME_HEIGHT * 4);
      this.onFrame({ width: FRAME_WIDTH, height: FRAME_HEIGHT, data, timestamp: this.frameCount });
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
        case 'prg':
          x.c64_loadPRG(ptr, options.data.length, 1);
          break;
        case 'd64':
          x.c64_setDriveEnabled(1);
          x.c64_insertDisk(ptr, options.data.length);
          break;
        case 'crt':
          if (this.crtPreloadChecksEnabled) {
            const info = parseCrtInfo(options.data);
            if (!info) {
              throw new Error('Invalid CRT file format');
            }
            const unsupportedReason = getUnsupportedCrtReason(info);
            if (unsupportedReason) {
              throw new Error(unsupportedReason);
            }
          }
          x.c64_loadCartridge(ptr, options.data.length);
          break;
        case 'snapshot':
          this.loadSnapshotData(ptr, options.data.length);
          break;
      }
    } finally {
      this.wasm.free(ptr);
    }
  }

  removeCartridge(): void {
    this.wasm.exports?.c64_removeCartridge();

    this.wasm.exports?.c64_reset();
    this.frameCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  handleInput(event: InputEvent): void {
    const x = this.wasm.exports;
    if (!x) return;

    if (event.type === 'key' && event.key !== undefined) {
      x.keyboard_keyPressed(Number(event.key));
    } else if (event.type === 'joystick') {
      const port = (event.joystickPort ?? 1) - 1; // callers use 1/2, WASM uses 0/1
      const dirMap: Record<string, number> = { up: 1, down: 2, left: 4, right: 8 };
      if (event.direction) x.c64_joystick_push(port, dirMap[event.direction] ?? 0);
      if (event.fire1) x.c64_joystick_push(port, 16);
    }
  }

  keyDown(keyCode: number): void {
    this.wasm.exports?.keyboard_keyPressed(keyCode);
  }
  keyUp(keyCode: number): void {
    this.wasm.exports?.keyboard_keyReleased(keyCode);
  }

  /**
   * Push (press) a joystick direction or fire button.
   *
   * @param port - 1-based joystick port: `1` = port 1, `2` = port 2
   * @param dir  - Bitmask value for the direction or fire button:
   *   - `0x01` — Up    (`JOYSTICK_DIRECTION.UP`)
   *   - `0x02` — Down  (`JOYSTICK_DIRECTION.DOWN`)
   *   - `0x04` — Left  (`JOYSTICK_DIRECTION.LEFT`)
   *   - `0x08` — Right (`JOYSTICK_DIRECTION.RIGHT`)
   *   - `0x10` — Fire  (`JOYSTICK_FIRE_1`)
   *
   * @example
   * emulator.joystickPush(2, JOYSTICK_DIRECTION.UP);    // port 2 up
   * emulator.joystickPush(2, JOYSTICK_FIRE_1);           // port 2 fire
   */
  joystickPush(port: JoystickPort, dir: JoystickInput): void {
    this.wasm.exports?.c64_joystick_push(port - 1, dir);
  }

  /**
   * Release a joystick direction or fire button.
   *
   * @param port - 1-based joystick port: `1` = port 1, `2` = port 2
   * @param dir  - Bitmask value to release (same values as {@link joystickPush})
   *
   * @example
   * emulator.joystickRelease(2, JOYSTICK_DIRECTION.UP);  // release port 2 up
   */
  joystickRelease(port: JoystickPort, dir: JoystickInput): void {
    this.wasm.exports?.c64_joystick_release(port - 1, dir);
  }
  mousePosition(x: number, y: number): void {
    this.wasm.exports?.c64_mouse_position(x, y);
  }

  // ---------------------------------------------------------------------------
  // Memory access
  // ---------------------------------------------------------------------------

  ramRead(addr: number): number {
    return this.wasm.exports?.c64_ramRead(addr) ?? 0;
  }
  ramWrite(addr: number, v: number): void {
    this.wasm.exports?.c64_ramWrite(addr, v);
  }
  cpuRead(addr: number): number {
    return this.wasm.exports?.c64_cpuRead(addr) ?? 0;
  }
  cpuWrite(addr: number, v: number): void {
    this.wasm.exports?.c64_cpuWrite(addr, v);
  }

  // ---------------------------------------------------------------------------
  // CPU state
  // ---------------------------------------------------------------------------

  getPC(): number {
    return this.wasm.exports?.c64_getPC() ?? 0;
  }
  getRegA(): number {
    return this.wasm.exports?.c64_getRegA() ?? 0;
  }
  getRegX(): number {
    return this.wasm.exports?.c64_getRegX() ?? 0;
  }
  getRegY(): number {
    return this.wasm.exports?.c64_getRegY() ?? 0;
  }
  getSP(): number {
    return this.wasm.exports?.c64_getSP() ?? 0;
  }
  getCycleCount(): number {
    return this.wasm.exports?.c64_getCycleCount() ?? 0;
  }

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

  private loadSnapshotData(ptr: number, len: number): void {
    const x = this.wasm.exports;
    if (!x) throw new Error('WASM not ready');
    x.c64_loadSnapshot(ptr, len);
    this.frameCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Debugger
  // ---------------------------------------------------------------------------

  debuggerPause(): void {
    this.wasm.exports?.debugger_pause();
  }
  debuggerPlay(): void {
    this.wasm.exports?.debugger_play();
  }
  debuggerStep(): void {
    this.wasm.exports?.debugger_step();
  }
  debuggerIsRunning(): boolean {
    return (this.wasm.exports?.debugger_isRunning() ?? 0) !== 0;
  }
  setDebugSpeed(speed: number): void {
    this.wasm.exports?.debugger_set_speed(speed);
  }

  // ---------------------------------------------------------------------------
  // Audio / SID
  // ---------------------------------------------------------------------------

  setSampleRate(rate: number): void {
    this.wasm.exports?.sid_setSampleRate(rate);
  }

  /**
   * Return a snapshot of the SID's circular audio buffer (4096 Float32 samples).
   * This mirrors the original c64.js `audioProcess` which reads
   * `sid_getAudioBuffer()` with a fixed `audioBufferLength` — never calling
   * `sid_dumpBuffer()`.
   */
  getSidBuffer(): Float32Array | null {
    const x = this.wasm.exports;
    if (!x || !this.wasm.heap) return null;
    const ptr = x.sid_getAudioBuffer();
    // Return a copy so the caller owns the data (the SID overwrites this buffer)
    return new Float32Array(
      this.wasm.heap.heapF32.subarray(ptr >> 2, (ptr >> 2) + C64Emulator.AUDIO_BUFFER_SIZE),
    );
  }

  setSIDModel(model: number): void {
    this.wasm.exports?.sid_setModel(model);
  }
  setVoiceEnabled(voice: number, enabled: boolean): void {
    this.wasm.exports?.sid_setVoiceEnabled(enabled ? voice : 0);
  }

  // ---------------------------------------------------------------------------
  // Drive
  // ---------------------------------------------------------------------------

  setDriveEnabled(enabled: boolean): void {
    this.wasm.exports?.c64_setDriveEnabled(enabled ? 1 : 0);
  }
  getDriveEnabled(): boolean {
    return (this.wasm.exports?.c64_getDriveEnabled() ?? 0) !== 0;
  }
}
