import { C64Emulator } from '../emulator/c64-emulator';
import { domKeyToC64Actions } from '../emulator/input';
import { getUnsupportedCrtReason, parseCrtInfo } from '../emulator/crt-info';
import type { GameLoadOptions } from '../types';
import type { JoystickPort } from '../emulator/constants';
import type { InputMode } from '../emulator/input';
import type CanvasRenderer from './canvas-renderer';
import { AudioEngine } from './audio-engine';
import InputHandler from './input-handler';
import { getLoadTypeLabel, inferLoadTypeFromFilename } from './load-formats';

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
    this.attachInputAndRenderer(this.emulator, renderer);

    if (gameUrl && gameUrl !== 'null') {
      await this.loadGame(gameUrl, gameType, onProgress);
    }

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

    // Notify the UI whenever audio state changes
    this.audio.onStateChange = (state) => {
      window.dispatchEvent(new CustomEvent('c64-audio-state', { detail: state }));
    };

    // Fire-and-forget init
    this.audio.init().then((autoplayOk) => {
      if (!this.emulator) return;
      // Tell the SID what sample rate we're using (matches AudioContext)
      this.emulator.setSampleRate(this.audio.sampleRate);

      // Give the engine a reader that snapshots the SID circular buffer
      this.audio.setSidBufferReader(() => this.emulator?.getSidBuffer() ?? null);

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

    onProgress?.(90, `INSERTING ${formatLoadProgressLabel(type)}...`);
    this.assertSnapshotFormatSupported(data, type, url);
    this.emitSnapshotLoadInfo(type, url);
    try {
      if (type === 'crt') {
        const filename = url.split('/').pop() ?? url;
        validateCrtSupportOrThrow(data, filename, onProgress);
      }
      this.emulator.loadGame({ type, data });
      if (type === 'prg') {
        await this.autoRunPrgIfRunning();
      }
      onProgress?.(100, 'READY!');
      // Notify UI that load succeeded
      window.dispatchEvent(new CustomEvent('c64-load-success', { detail: { url, type } }));
    } catch (err) {
      onProgress?.(0, 'FAILED');
      console.error('Failed to insert cartridge or load game:', err);
      // Surface a global event so UI can react if needed
      window.dispatchEvent(
        new CustomEvent('c64-load-error', {
          detail: { error: err instanceof Error ? err.message : String(err), url, type },
        }),
      );
      throw err;
    }
  }

  // Load a game from a File/Blob provided by the user (drag & drop / file input)
  async loadFile(file: File, type?: GameLoadOptions['type']): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call start() first');
    const onProgress = this.options.onProgress;
    const resolvedType = type ?? inferLoadTypeFromFilename(file.name) ?? 'crt';
    try {
      onProgress?.(20, `READING FILE ${file.name}...`);
      const ab = await file.arrayBuffer();
      const data = new Uint8Array(ab);
      onProgress?.(90, `INSERTING ${formatLoadProgressLabel(resolvedType)}...`);
      this.assertSnapshotFormatSupported(data, resolvedType, file.name);
      this.emitSnapshotLoadInfo(resolvedType, file.name);
      try {
        if (resolvedType === 'crt') {
          validateCrtSupportOrThrow(data, file.name, onProgress);
        }
        this.emulator.loadGame({ type: resolvedType, data });
        if (resolvedType === 'prg') {
          await this.autoRunPrgIfRunning();
        }
        onProgress?.(100, 'READY!');
        window.dispatchEvent(
          new CustomEvent('c64-close-dialog', { detail: { file: file.name, type: resolvedType } }),
        );
      } catch (err) {
        onProgress?.(0, 'FAILED');
        console.error('Failed to insert cartridge from file:', err);
        window.dispatchEvent(
          new CustomEvent('c64-load-error', {
            detail: {
              error: err instanceof Error ? err.message : String(err),
              file: file.name,
              type: resolvedType,
            },
          }),
        );
        throw err;
      }
    } catch (err) {
      onProgress?.(0, 'FAILED');
      throw err;
    }
  }

  async loadTool(url: string, type?: GameLoadOptions['type']): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call start() first');
    const onProgress = this.options.onProgress;
    const resolvedType = type ?? inferLoadTypeFromFilename(url) ?? 'prg';

    onProgress?.(10, 'PREPARING TOOL...');
    try {
      this.emulator.removeCartridge();
    } catch {
      // ignore if no cartridge is mounted
    }
    this.emulator.reset();
    this.emulator.start();
    await waitMs(120);

    await this.loadGame(url, resolvedType, onProgress);
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

  async reboot(): Promise<void> {
    if (!this.emulator) return;
    try {
      await this.emulator.reboot();
      this.attachInputAndRenderer(this.emulator, this.options.renderer);
      this.emulator.start();
      this.emulator.setSampleRate(this.audio.sampleRate);
      this.audio.setSidBufferReader(() => this.emulator?.getSidBuffer() ?? null);
      window.dispatchEvent(new CustomEvent('c64-reboot', { detail: {} }));
      window.dispatchEvent(new CustomEvent('c64-close-menu'));
    } catch (e) {
      console.error('Failed to reboot emulator:', e);
      throw e;
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

  private async autoRunPrgIfRunning(): Promise<void> {
    if (!this.emulator || !this.emulator.isRunning()) return;
    await waitMs(220);
    await this.typeCommand('run\n');
  }

  private async typeCommand(command: string): Promise<void> {
    if (!this.emulator) return;

    for (const char of command) {
      const domKey = char === '\n' ? 'enter' : char;

      const down = domKeyToC64Actions(domKey, false, 'keydown');
      for (const act of down) {
        if (act.action === 'press') this.emulator.keyDown(act.key);
        else this.emulator.keyUp(act.key);
      }

      await waitMs(22);

      const up = domKeyToC64Actions(domKey, false, 'keyup');
      for (const act of up) {
        if (act.action === 'press') this.emulator.keyDown(act.key);
        else this.emulator.keyUp(act.key);
      }

      await waitMs(22);
    }
  }

  private emitSnapshotLoadInfo(type: GameLoadOptions['type'], source: string): void {
    if (type !== 'snapshot') return;

    const mode = 'native';
    const message = `Loading native LVL snapshot (${source})`;

    console.info(`[snapshot] mode=${mode} source=${source}`);
    window.dispatchEvent(new CustomEvent('c64-load-info', { detail: { mode, source, message } }));
  }

  private assertSnapshotFormatSupported(
    data: Uint8Array,
    type: GameLoadOptions['type'],
    source: string,
  ): void {
    if (type !== 'snapshot') return;
    if (!hasViceSnapshotMagic(data)) return;

    const err = new Error(
      `Unsupported snapshot format for ${source}. VICE .vsf snapshots are disabled for now; use LVLLVL/native snapshots (.c64, .snapshot, .s64).`,
    );
    console.error(err);
    window.dispatchEvent(
      new CustomEvent('c64-load-info', {
        detail: {
          mode: 'warning',
          source,
          message: 'Snapshot must be LVLLVL/native format (.c64, .snapshot, .s64).',
        },
      }),
    );
    throw err;
  }

  private attachInputAndRenderer(emulator: C64Emulator, renderer: CanvasRenderer): void {
    this.inputHandler?.detach();
    this.inputHandler = new InputHandler(emulator);
    this.inputHandler.attach();
    renderer.attachTo(emulator);
  }
}

function validateCrtSupportOrThrow(
  data: Uint8Array,
  source: string,
  onProgress?: ProgressCallback,
): void {
  const info = parseCrtInfo(data, source);
  if (!info) {
    onProgress?.(0, 'INVALID CRT');
    const err = new Error('Invalid CRT file format');
    console.error(err);
    throw err;
  }
  console.log(info.line);
  const unsupportedReason = getUnsupportedCrtReason(info);
  if (unsupportedReason) {
    onProgress?.(0, 'UNSUPPORTED CRT');
    const err = new Error(unsupportedReason);
    console.error(err);
    throw err;
  }
}

function formatLoadProgressLabel(type: GameLoadOptions['type']): string {
  const label = getLoadTypeLabel(type);
  const suffixStart = label.indexOf(' (');
  const plain = suffixStart > 0 ? label.slice(0, suffixStart) : label;
  return plain.toUpperCase();
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasViceSnapshotMagic(data: Uint8Array): boolean {
  const magic = 'VICE Snapshot File\x1a';
  if (data.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (data[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}
