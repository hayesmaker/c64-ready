/**
 * Headless C64 emulator for server-side streaming / testing
 * Minimal MVP implementation: load WASM, wire frame/audio capture and input bridge,
 * expose step/run methods for consuming frames and audio in Node environments.
 */

import { C64Emulator } from '../emulator/c64-emulator';
import { FrameCapture } from './frame-capture';
import { AudioCapture } from './audio-capture';
import { InputBridge } from './input-bridge';
import type { GameLoadOptions, FrameBuffer, AudioBuffer, C64Config, InputEvent } from '../types';

export class C64Headless {
  private wasmUrl: string;
  private config?: Partial<C64Config>;
  private emulator: C64Emulator | null = null;
  private frameCapture = new FrameCapture();
  private audioCapture = new AudioCapture();
  readonly inputBridge = new InputBridge();

  constructor(wasmUrl: string = '/src/emulator/c64.wasm', config?: Partial<C64Config>) {
    this.wasmUrl = wasmUrl;
    this.config = config;

    // Forward remote input into the emulator when available
    this.inputBridge.onInput = (ev: InputEvent) => {
      this.emulator?.handleInput(ev);
    };
  }

  /** Load and initialise the WASM emulator */
  async init(): Promise<void> {
    this.emulator = await C64Emulator.load(this.wasmUrl, this.config ?? {});

    // Wire capture callbacks
    this.emulator.onFrame = (frame: FrameBuffer) => this.frameCapture.capture(frame);
    this.emulator.onAudio = (audio: AudioBuffer) => this.audioCapture.capture(audio);
  }

  async loadGame(options: GameLoadOptions): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call init() first');
    this.emulator.loadGame(options);
  }

  async reboot(): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call init() first');
    await this.emulator.reboot();
  }

  /**
   * Run a single emulation tick/frame and return the captured latest frame/audio.
   * This will start the emulator if it was not running, and restore the previous
   * running state afterwards.
   */
  stepAndCapture(dTime: number = 0): { frame: Uint8Array | null; audio: Float32Array | null } {
    if (!this.emulator) throw new Error('Emulator not initialised — call init() first');

    const wasRunning = this.emulator.isRunning();
    if (!wasRunning) this.emulator.start();

    // Tick once (dTime in ms). If 0, emulator.tick will clamp to ~60fps like browser.
    this.emulator.tick(dTime);

    const frame = this.frameCapture.getLatest();
    const audio = this.audioCapture.getLatest();

    if (!wasRunning) this.emulator.pause();

    return { frame, audio };
  }

  /**
   * Continuous run loop for streaming. Calls onFrame / onAudio for every tick
   * until the emulator is paused via stop().
   */
  async runLoop(
    onFrame?: (data: Uint8Array) => void,
    onAudio?: (data: Float32Array) => void,
  ): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call init() first');
    this.emulator.start();

    while (this.emulator.isRunning()) {
      this.emulator.tick(0);
      const frame = this.frameCapture.getLatest();
      const audio = this.audioCapture.getLatest();
      if (frame && onFrame) onFrame(frame);
      if (audio && onAudio) onAudio(audio);
      // yield to node event loop
      // Use setImmediate which is available in Node; fall back to a timeout if not present
      await new Promise<void>((resolve) =>
        typeof (globalThis as unknown as { setImmediate?: (cb: () => void) => void })
          .setImmediate === 'function'
          ? (globalThis as unknown as { setImmediate?: (cb: () => void) => void }).setImmediate!(
              resolve,
            )
          : setTimeout(resolve, 0),
      );
    }
  }

  feedInput(json: string): void {
    this.inputBridge.receiveRemoteInput(json);
  }

  stop(): void {
    this.emulator?.pause();
  }
}
