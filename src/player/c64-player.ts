import { C64Emulator } from '../emulator/c64-emulator';
import { parseCrtInfo } from '../emulator/crt-info';
import type { GameLoadOptions } from '../types';
import type { JoystickPort } from '../emulator/constants';
import type { InputMode } from '../emulator/input';
import type CanvasRenderer from './canvas-renderer';
import { AudioEngine } from './audio-engine';
import InputHandler from './input-handler';

export type ProgressCallback = (percent: number, label: string) => void;

export interface C64PlayerOptions {
  wasmUrl: string;
  gameUrl: string;
  gameType?: GameLoadOptions['type'];
  renderer: CanvasRenderer;
  onProgress?: ProgressCallback;
}

export class C64Player {
  private emulator: C64Emulator | null = null;
  private inputHandler: InputHandler | null = null;
  readonly audio = new AudioEngine();
  private readonly options: Required<Pick<C64PlayerOptions, 'wasmUrl' | 'gameUrl' | 'gameType'>> &
    C64PlayerOptions;

  constructor(options: C64PlayerOptions) {
    this.options = { gameType: 'crt', ...options };
  }

  async start(): Promise<void> {
    const { wasmUrl, gameUrl, gameType, renderer, onProgress } = this.options;

    onProgress?.(10, 'INITIALISING WASM...');
    this.emulator = await C64Emulator.load(wasmUrl);

    this.inputHandler = new InputHandler(this.emulator);
    this.inputHandler.attach();
    renderer.attachTo(this.emulator);

    await this.loadGame(gameUrl, gameType, onProgress);

    this.emulator.start();

    // Initialise audio in the background — never blocks game startup
    this.initAudio();
  }

  /**
   * Set up the AudioEngine and wire it to the emulator.
   *
   * The SID fills its audio buffer continuously as CPU cycles run.
   * The AudioEngine pulls a snapshot of that buffer on its own timer
   * (matching the rate of the original ScriptProcessorNode), keeping
   * audio and emulation timing independent.
   */
  private initAudio(): void {
    if (!this.emulator) return;
    const emulator = this.emulator;

    // Notify the UI whenever audio state changes
    this.audio.onStateChange = (state) => {
      window.dispatchEvent(new CustomEvent('c64-audio-state', { detail: state }));
    };

    // Fire-and-forget init
    this.audio.init().then((autoplayOk) => {
      // Tell the SID what sample rate we're using (matches AudioContext)
      emulator.setSampleRate(this.audio.sampleRate);

      // Give the engine a reader that snapshots the SID circular buffer
      this.audio.setSidBufferReader(() => emulator.getSidBuffer());

      if (!autoplayOk) {
        window.dispatchEvent(new CustomEvent('c64-audio-suspended'));
      }
    });
  }

  async loadGame(
    url: string,
    type: GameLoadOptions['type'] = 'crt',
    onProgress?: ProgressCallback,
  ): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call start() first');

    onProgress?.(20, 'LOADING GAME...');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch game: ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    let data: Uint8Array;

    if (contentLength > 0 && response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      let result = await reader.read();
      while (!result.done) {
        chunks.push(result.value);
        loaded += result.value.byteLength;
        const pct = 20 + Math.round((loaded / contentLength) * 65);
        onProgress?.(pct, `LOADING GAME... ${Math.round((loaded / contentLength) * 100)}%`);
        result = await reader.read();
      }

      data = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      data = new Uint8Array(await response.arrayBuffer());
    }

    onProgress?.(90, 'INSERTING CARTRIDGE...');
    // Basic validation for cartridge files — some malformed .crt files can
    // silently fail inside the WASM loader; catch common format problems here
    if (type === 'crt' && !isValidCRT(data)) {
      onProgress?.(0, 'INVALID CRT');
      const err = new Error('Invalid CRT file format');
      console.error(err);
      throw err;
    }
    if (type === 'crt') {
      const filename = url.split('/').pop() ?? url;
      const info = parseCrtInfo(data, filename);
      if (info) console.log(info.line);
    }
    try {
      this.emulator.loadGame({ type, data });
      onProgress?.(100, 'READY!');
      // Notify UI that load succeeded
      window.dispatchEvent(new CustomEvent('c64-load-success', { detail: { url, type } }));
    } catch (err) {
      onProgress?.(0, 'FAILED');
      console.error('Failed to insert cartridge or load game:', err);
      // Surface a global event so UI can react if needed
      window.dispatchEvent(
        new CustomEvent('c64-load-error', { detail: { error: String(err), url, type } }),
      );
      throw err;
    }
  }

  // Load a game from a File/Blob provided by the user (drag & drop / file input)
  async loadFile(file: File, type: GameLoadOptions['type'] = 'crt'): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call start() first');
    const onProgress = this.options.onProgress;
    try {
      onProgress?.(20, `READING FILE ${file.name}...`);
      const ab = await file.arrayBuffer();
      const data = new Uint8Array(ab);
      onProgress?.(90, 'INSERTING CARTRIDGE...');
      if (type === 'crt' && !isValidCRT(data)) {
        onProgress?.(0, 'INVALID CRT');
        const err = new Error('Invalid CRT file format');
        console.error(err);
        throw err;
      }
      if (type === 'crt') {
        const info = parseCrtInfo(data, file.name);
        if (info) console.log(info.line);
      }
      try {
        this.emulator.loadGame({ type, data });
        onProgress?.(100, 'READY!');
        window.dispatchEvent(
          new CustomEvent('c64-close-dialog', { detail: { file: file.name, type } }),
        );
      } catch (err) {
        onProgress?.(0, 'FAILED');
        console.error('Failed to insert cartridge from file:', err);
        window.dispatchEvent(
          new CustomEvent('c64-load-error', {
            detail: { error: String(err), file: file.name, type },
          }),
        );
        throw err;
      }
    } catch (err) {
      onProgress?.(0, 'FAILED');
      throw err;
    }
  }

  // Expose cartridge / reset controls for UI
  detachCartridge(): void {
    if (!this.emulator) return;
    try {
      this.emulator.removeCartridge();
      window.dispatchEvent(new CustomEvent('c64-detach', { detail: {} }));
      window.dispatchEvent(new CustomEvent('c64-close-menu'));
    } catch (e) {
      console.error('Failed to detach cartridge:', e);
    }
  }

  hardReset(): void {
    if (!this.emulator) return;
    try {
      this.emulator.reset();
      // Ensure emulator resumes after reset
      this.emulator.start();
      window.dispatchEvent(new CustomEvent('c64-hard-reset', { detail: {} }));
      window.dispatchEvent(new CustomEvent('c64-close-menu'));
    } catch (e) {
      console.error('Failed to perform hard reset:', e);
    }
  }

  /**
   * Change which joystick port keyboard events map to (1 or 2).
   * Delegates to the InputHandler created during start().
   */
  setKeyboardJoystickPort(port: JoystickPort): void {
    this.inputHandler?.setKeyboardJoystickPort(port);
  }

  /**
   * Change the input mode ('joystick' | 'keyboard' | 'mixed').
   * - 'joystick' — arrows + ControlLeft control the joystick only (default)
   * - 'keyboard' — all keys go to the C64 keyboard matrix
   * - 'mixed'    — arrows + Z + ControlLeft drive the joystick; all other
   *                keys route to the C64 keyboard matrix simultaneously
   */
  setInputMode(mode: InputMode): void {
    this.inputHandler?.setInputMode(mode);
  }
}

// CRT format validator — delegates to parseCrtInfo so magic-check logic lives in one place.
function isValidCRT(data: Uint8Array): boolean {
  return parseCrtInfo(data) !== null;
}
