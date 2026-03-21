import { C64Emulator } from '../emulator/c64-emulator';
import type { GameLoadOptions } from '../types';
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
    this.emulator.loadGame({ type, data });
    onProgress?.(100, 'READY!');
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
      this.emulator.loadGame({ type, data });
      onProgress?.(100, 'READY!');
    } catch (err) {
      onProgress?.(0, 'FAILED');
      throw err;
    }
  }
}
