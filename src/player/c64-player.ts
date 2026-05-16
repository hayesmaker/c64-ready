import { C64Emulator } from '../emulator/c64-emulator';
import { getUnsupportedCrtReason, parseCrtInfo } from '../emulator/crt-info';
import type { GameLoadOptions } from '../types';
import type { JoystickPort } from '../emulator/constants';
import type { InputMode } from '../emulator/input';
import type CanvasRenderer from './canvas-renderer';
import { AudioEngine, type AudioEngineOptions } from './audio-engine';
import InputHandler from './input-handler';
import { getLoadTypeLabel, inferLoadTypeFromFilename } from './load-formats';

export type ProgressCallback = (percent: number, label: string) => void;

const C64_KEYBOARD_BUFFER_LENGTH_ADDR = 0x00c6;
const C64_KEYBOARD_BUFFER_ADDR = 0x0277;
const C64_KEYBOARD_BUFFER_MAX_LENGTH = 8;
const PRG_AUTORUN_DELAY_MS = 650;
const DISK_AUTOLOAD_DELAY_MS = 1500;
const DISK_AUTOLOAD_RETURN_DELAY_MS = 250;
const PRG_AUTORUN_BUFFER_TIMEOUT_MS = 2000;

export interface C64PlayerOptions {
  wasmUrl: string;
  gameUrl: string;
  gameData?: Uint8Array<ArrayBufferLike> | ArrayBufferLike | string;
  gameSource?: string;
  gameType?: GameLoadOptions['type'];
  renderer: CanvasRenderer;
  onProgress?: ProgressCallback;
  audio?: AudioEngineOptions;
}

export class C64Player {
  private emulator: C64Emulator | null = null;
  private inputHandler: InputHandler | null = null;
  private disableCrtPreloadChecks: boolean = false;
  private destroyed: boolean = false;
  private diskSessionActive: boolean = false;
  private startupLoadInProgress: boolean = false;
  private startupDiskAutoloadPending: boolean = false;
  readonly audio: AudioEngine;
  private readonly options: Required<Pick<C64PlayerOptions, 'wasmUrl' | 'gameUrl' | 'gameType'>> &
    C64PlayerOptions;

  constructor(options: C64PlayerOptions) {
    this.options = { gameType: 'crt', ...options };
    this.audio = new AudioEngine(options.audio);
  }

  async start(): Promise<void> {
    this.destroyed = false;
    const { wasmUrl, gameUrl, gameData, gameSource, gameType, renderer, onProgress } = this.options;

    onProgress?.(10, 'INITIALISING WASM...');
    this.emulator = await C64Emulator.load(wasmUrl);
    this.emulator.setCrtPreloadChecksEnabled(!this.disableCrtPreloadChecks);
    this.attachInputAndRenderer(this.emulator, renderer);
    let shouldAutoRunPrgAfterStart = false;

    if (gameData !== undefined && gameData !== null) {
      this.startupLoadInProgress = true;
      try {
        await this.loadGameData(gameData, gameType, gameSource ?? 'inline game data', onProgress);
      } finally {
        this.startupLoadInProgress = false;
      }
      shouldAutoRunPrgAfterStart = gameType === 'prg';
    } else if (gameUrl && gameUrl !== 'null') {
      this.startupLoadInProgress = true;
      try {
        await this.loadGame(gameUrl, gameType, onProgress);
      } finally {
        this.startupLoadInProgress = false;
      }
      shouldAutoRunPrgAfterStart = gameType === 'prg';
    }

    this.emulator.start();
    if (shouldAutoRunPrgAfterStart) {
      await this.autoRunPrgIfRunning();
    }
    if (this.startupDiskAutoloadPending) {
      this.startupDiskAutoloadPending = false;
      await this.autoLoadDiskIfRunning();
    }

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
    let data: Uint8Array<ArrayBufferLike>;

    if (contentLength > 0 && response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBufferLike>[] = [];
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
    await this.insertGameData(data, type, url, { url }, onProgress);
  }

  async loadGameData(
    gameData: Uint8Array<ArrayBufferLike> | ArrayBufferLike | string,
    type: GameLoadOptions['type'] = 'crt',
    source: string = 'inline game data',
    onProgress: ProgressCallback | undefined = this.options.onProgress,
  ): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call start() first');

    onProgress?.(20, 'LOADING GAME DATA...');
    const data = normaliseGameData(gameData);
    onProgress?.(90, `INSERTING ${formatLoadProgressLabel(type)}...`);
    await this.insertGameData(data, type, source, { source }, onProgress);
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
      await this.insertGameData(data, resolvedType, file.name, { file: file.name }, onProgress);
      window.dispatchEvent(
        new CustomEvent('c64-close-dialog', { detail: { file: file.name, type: resolvedType } }),
      );
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
      this.diskSessionActive = false;
      this.startupDiskAutoloadPending = false;
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
      this.diskSessionActive = false;
      this.startupDiskAutoloadPending = false;
      this.emulator.setSampleRate(this.audio.sampleRate);
      this.audio.setSidBufferReader(() => this.emulator?.getSidBuffer() ?? null);
      window.dispatchEvent(new CustomEvent('c64-reboot', { detail: {} }));
      window.dispatchEvent(new CustomEvent('c64-close-menu'));
    } catch (e) {
      console.error('Failed to reboot emulator:', e);
      throw e;
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    try {
      this.emulator?.pause();
    } finally {
      this.inputHandler?.detach();
      this.inputHandler = null;
      this.options.renderer.detach();
      this.audio.onStateChange = undefined;
      this.audio.setSidBufferReader(() => null);
      await this.audio.destroy();
      this.emulator = null;
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

  setActiveGamepadIndex(index: number): void {
    this.inputHandler?.setActiveGamepadIndex(index);
  }

  getActiveGamepadIndex(): number {
    return this.inputHandler?.getActiveGamepadIndex() ?? -1;
  }

  getSnapshot(): Uint8Array<ArrayBufferLike> {
    if (!this.emulator) {
      throw new Error('Emulator not initialised');
    }
    return this.emulator.getSnapshot();
  }

  ramRead(addr: number): number {
    return this.emulator?.ramRead(addr) ?? 0;
  }

  cpuRead(addr: number): number {
    return this.emulator?.cpuRead(addr) ?? 0;
  }

  cpuReadNS(addr: number): number {
    return this.emulator?.cpuReadNS(addr) ?? 0;
  }

  setVoiceEnabled(voice: number, enabled: boolean): void {
    this.emulator?.setVoiceEnabled(voice, enabled);
  }

  setCrtPreloadChecksDisabled(disabled: boolean): void {
    this.disableCrtPreloadChecks = disabled;
    this.emulator?.setCrtPreloadChecksEnabled(!disabled);
  }

  private async autoRunPrgIfRunning(): Promise<void> {
    if (!this.emulator || !this.emulator.isRunning()) return;
    await waitMs(PRG_AUTORUN_DELAY_MS);
    await this.insertTextIntoKeyboardBuffer('run\n');
  }

  private async autoLoadDiskIfRunning(): Promise<void> {
    if (!this.emulator || !this.emulator.isRunning()) return;
    await waitMs(DISK_AUTOLOAD_DELAY_MS);
    await this.insertTextIntoKeyboardBuffer('LOAD"*",8,1');
    await waitMs(DISK_AUTOLOAD_RETURN_DELAY_MS);
    await this.insertTextIntoKeyboardBuffer('\n');
    await this.waitForKeyboardBufferEmpty();
    await this.insertTextIntoKeyboardBuffer('run\n');
  }

  private async prepareFirstDiskLoad(): Promise<void> {
    if (!this.emulator || this.startupLoadInProgress) return;
    try {
      this.emulator.removeCartridge();
    } catch {
      this.emulator.reset();
    }
    this.emulator.start();
    await waitMs(120);
  }

  private async insertTextIntoKeyboardBuffer(text: string): Promise<void> {
    if (!this.emulator) return;

    const bytes = normaliseKeyboardBufferText(text);
    while (bytes.length > 0) {
      await this.waitForKeyboardBufferEmpty();

      const chunk = bytes.splice(0, C64_KEYBOARD_BUFFER_MAX_LENGTH);
      this.emulator.cpuWrite(C64_KEYBOARD_BUFFER_LENGTH_ADDR, chunk.length);
      for (let i = 0; i < chunk.length; i += 1) {
        this.emulator.cpuWrite(C64_KEYBOARD_BUFFER_ADDR + i, chunk[i]);
      }
    }
  }

  private async waitForKeyboardBufferEmpty(): Promise<void> {
    const startedAt = Date.now();
    while (this.emulator?.cpuRead(C64_KEYBOARD_BUFFER_LENGTH_ADDR)) {
      if (Date.now() - startedAt >= PRG_AUTORUN_BUFFER_TIMEOUT_MS) {
        throw new Error('Timed out waiting for C64 keyboard buffer before PRG auto-run');
      }
      await waitMs(50);
    }
  }

  private async insertGameData(
    data: Uint8Array<ArrayBufferLike>,
    type: GameLoadOptions['type'],
    source: string,
    eventDetail: Record<string, unknown>,
    onProgress?: ProgressCallback,
  ): Promise<void> {
    if (!this.emulator) throw new Error('Emulator not initialised — call start() first');

    this.assertSnapshotFormatSupported(data, type, source);
    this.emitSnapshotLoadInfo(type, source);
    try {
      if (type === 'crt') {
        this.handleCrtPreloadChecks(data, source, onProgress);
      }
      const shouldAutoLoadDisk = type === 'd64' && !this.diskSessionActive;
      if (shouldAutoLoadDisk) {
        await this.prepareFirstDiskLoad();
      }
      this.emulator.loadGame({ type, data });
      if (type === 'prg') {
        this.diskSessionActive = false;
        await this.autoRunPrgIfRunning();
      } else if (type === 'd64') {
        this.diskSessionActive = true;
        if (shouldAutoLoadDisk) {
          if (this.startupLoadInProgress) this.startupDiskAutoloadPending = true;
          else await this.autoLoadDiskIfRunning();
        }
      } else {
        this.diskSessionActive = false;
      }
      onProgress?.(100, 'READY!');
      window.dispatchEvent(
        new CustomEvent('c64-load-success', { detail: { ...eventDetail, type } }),
      );
    } catch (err) {
      onProgress?.(0, 'FAILED');
      console.error('Failed to insert cartridge or load game:', err);
      window.dispatchEvent(
        new CustomEvent('c64-load-error', {
          detail: { error: err instanceof Error ? err.message : String(err), ...eventDetail, type },
        }),
      );
      throw err;
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
    data: Uint8Array<ArrayBufferLike>,
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

  private handleCrtPreloadChecks(
    data: Uint8Array<ArrayBufferLike>,
    source: string,
    onProgress?: ProgressCallback,
  ): void {
    if (!this.disableCrtPreloadChecks) {
      validateCrtSupportOrThrow(data, source, onProgress);
      return;
    }

    const info = parseCrtInfo(data, source);
    if (!info) return;

    console.log(info.line);
    const unsupportedReason = getUnsupportedCrtReason(info);
    if (!unsupportedReason) return;

    onProgress?.(90, 'UNSAFE CRT LOAD');
    const message =
      'Preload checks are disabled. This cartridge is normally flagged as incompatible and may hang the emulator.';
    console.warn(`${unsupportedReason} Proceeding because preload checks are disabled.`);
    window.dispatchEvent(
      new CustomEvent('c64-load-info', {
        detail: {
          mode: 'warning',
          source,
          message,
        },
      }),
    );
  }
}

function validateCrtSupportOrThrow(
  data: Uint8Array<ArrayBufferLike>,
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

function normaliseKeyboardBufferText(text: string): number[] {
  const bytes: number[] = [];
  const normalised = text.toUpperCase().replace(/\r\n/g, '\n');

  for (let i = 0; i < normalised.length; i += 1) {
    const code = normalised.charCodeAt(i);
    bytes.push(code === 10 ? 13 : code);
  }

  return bytes;
}

function normaliseGameData(
  gameData: Uint8Array<ArrayBufferLike> | ArrayBufferLike | string,
): Uint8Array<ArrayBufferLike> {
  if (gameData instanceof Uint8Array) {
    return gameData;
  }

  if (typeof gameData !== 'string') {
    return new Uint8Array(gameData);
  }

  const trimmed = gameData.trim();
  const base64Match = trimmed.match(/^data:[^,]*;base64,(.*)$/s);
  const payload = base64Match ? base64Match[1] : trimmed;

  if (base64Match || looksLikeBase64(payload)) {
    const binary = globalThis.atob(payload.replace(/\s/g, ''));
    return binaryStringToBytes(binary);
  }

  return binaryStringToBytes(gameData);
}

function binaryStringToBytes(value: string): Uint8Array<ArrayBufferLike> {
  const data = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    data[i] = value.charCodeAt(i) & 0xff;
  }
  return data;
}

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s/g, '');
  return compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function hasViceSnapshotMagic(data: Uint8Array<ArrayBufferLike>): boolean {
  const magic = 'VICE Snapshot File\x1a';
  if (data.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (data[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}
