const css = `
.c64-help-btn,.c64-hamburger,.c64-unmute-btn{position:fixed;top:12px;width:36px;height:36px;border-radius:6px;border:2px solid #444;background:#111;color:#ddd;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1000}.c64-help-btn{right:12px;border-radius:50%;color:#7b71d5;font-family:monospace;font-size:18px;font-weight:bold}.c64-hamburger{left:12px;font-family:monospace}.c64-unmute-btn{left:56px;color:#f44;z-index:1010}.c64-unmute-btn.hidden{opacity:0;pointer-events:none}.c64-help-overlay,.c64-menu-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:1001;opacity:0;transition:opacity .25s ease;pointer-events:none}.c64-help-overlay.visible,.c64-menu-overlay.visible{opacity:1;pointer-events:auto}.c64-help-dialog,.c64-menu-panel{background:#1a1a2e;border:2px solid #555;border-radius:6px;padding:24px 32px;max-width:760px;width:90%;font-family:monospace;color:#ccc;position:relative}.c64-changelog-dialog{max-height:70vh;overflow:auto}.c64-help-dialog h2{margin:0 0 8px;font-size:16px;color:#7b71d5;letter-spacing:1px}.c64-help-dialog p{margin:0 0 16px;font-size:13px;line-height:1.5;color:#aaa}.c64-help-dialog a{color:#a8a8ff;text-decoration:none}.c64-help-controls,.c64-help-special{margin:0 0 12px;padding:0;list-style:none;font-size:13px}.c64-help-controls li,.c64-help-special li{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a3e}.c64-help-key{background:#2a2a3e;border:1px solid #444;border-radius:3px;padding:1px 8px;font-size:12px;color:#ddd}.c64-help-close{position:absolute;top:10px;right:14px;background:none;border:none;color:#888;font-size:20px;cursor:pointer}.c64-version{display:flex;justify-content:end;font-size:12px;color:#999;margin-top:36px}.c64-menu-overlay{align-items:flex-start;justify-content:flex-start;padding:48px 24px;background:rgba(0,0,0,.5);z-index:1002}.c64-menu-panel{min-width:320px;max-width:520px;padding:16px;background:#0f0f1a;border-color:#333}.c64-menu-header{display:flex;align-items:center;justify-content:space-between}.c64-settings-tabs,.c64-menu-actions,.c64-system-actions,.c64-radio-row,.c64-gamepad-list{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.c64-settings-tab,.c64-btn,.c64-mute-btn{background:#222;border:1px solid #444;color:#ddd;padding:6px 10px;border-radius:4px;cursor:pointer}.c64-settings-tab.active,.c64-gamepad-btn.active{border-color:#7b71d5;color:#fff;background:#25253d}.c64-select{background:#171729;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;font-family:monospace}.c64-form-row,.c64-audio-row,.c64-cart-preview{display:flex;align-items:center;gap:10px;margin-bottom:10px}.c64-section-label,.c64-audio-section label{display:block;margin:0 0 8px;font-size:13px;color:#aaa}.c64-section-hint,.c64-volume-label,.c64-cart-type{font-size:11px;color:#888}.c64-dragarea{border:2px dashed #2a2a3e;border-radius:6px;padding:12px;margin-top:12px;text-align:center;color:#aaa}.c64-dragarea.dragover{border-color:#7b71d5;color:#fff}.c64-file-input{display:none}.c64-volume-slider{flex:1}.c64-cart-filename{font-size:13px;color:#ccc;word-break:break-all}.c64-checkbox-row{display:inline-flex;gap:8px;align-items:center;color:#ccc;font-size:13px}
.c64-menu-overlay{align-items:center;justify-content:center;padding:0;background:rgba(0,0,0,.7)}
.c64-menu-panel{max-width:760px;width:90%;min-width:0;max-height:82vh;overflow:auto;padding:24px 32px;background:#1a1a2e;border:2px solid #555;border-radius:6px;color:#ccc;font-family:monospace;box-shadow:none}
.c64-menu-header{display:block;margin:0 0 16px;padding:0;border:0}.c64-menu-header h2{margin:0;font-size:16px;color:#7b71d5;letter-spacing:1px;text-transform:none}.c64-menu-close{position:absolute;top:10px;right:14px;background:none;border:none;color:#888;font-size:20px;cursor:pointer}
.c64-settings-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;padding:0;border:0;background:transparent}.c64-settings-tab{background:#2a2a3e;border:1px solid #444;border-radius:3px;color:#ddd;font:inherit;font-size:12px;padding:4px 10px;cursor:pointer}.c64-settings-tab.active{background:#3a335f;border-color:#7b71d5;color:#fff}
.c64-section-label{display:block;margin:0 0 8px;color:#7b71d5;font-size:13px;letter-spacing:1px;text-transform:uppercase}.c64-form-row,.c64-radio-row,.c64-system-actions,.c64-menu-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px}.c64-form-row label{color:#aaa;font-size:13px}
.c64-select,.c64-file-input{background:#111827;border:1px solid #444;border-radius:3px;color:#ddd;font:inherit;font-size:13px;padding:5px 8px}.c64-btn{background:#2a2a3e;border:1px solid #444;border-radius:3px;color:#ddd;font:inherit;font-size:12px;padding:5px 10px;cursor:pointer}.c64-btn:hover:not(:disabled){border-color:#7b71d5;color:#fff}.c64-btn:disabled,.c64-select:disabled{opacity:.55;cursor:not-allowed}
.c64-btn.active{background:#3a335f;border-color:#7b71d5;color:#fff}
.c64-dragarea{border:1px dashed #555;border-radius:6px;background:#111827;color:#aaa;padding:18px;margin:0 0 12px;text-align:center}.c64-dragarea.dragover{border-color:#7b71d5;background:#1f1b38;color:#fff}.c64-cart-preview,.c64-tools-section{background:#151527;border:1px solid #2a2a3e;border-radius:6px;padding:12px;margin:12px 0}.c64-section-hint{color:#888;font-size:12px;line-height:1.4;margin:4px 0 12px}.c64-checkbox-row{display:flex;align-items:center;gap:8px;color:#ccc;font-size:13px;margin:14px 0 4px}
.c64-text-input,.c64-textarea{background:#111827;border:1px solid #444;border-radius:3px;color:#ddd;font:inherit;font-size:13px;padding:5px 8px}.c64-text-input{min-width:180px}.c64-textarea{box-sizing:border-box;width:100%;min-height:120px;resize:vertical}.c64-cheevos-json-file{display:none}.c64-inline-status{color:#888;font-size:12px}
.c64-cheat-list{display:grid;gap:12px;margin:0 0 12px}.c64-cheat-card{background:#151527;border:1px solid #2a2a3e;border-radius:6px;padding:12px}.c64-cheat-card-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;color:#ddd;font-size:13px}.c64-cheat-remove{background:none;border:0;color:#ff9a9a;cursor:pointer;font:inherit;font-size:12px}.c64-cheat-grid{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 10px;align-items:center}.c64-cheat-input{background:#111827;border:1px solid #444;border-radius:3px;color:#ddd;font:inherit;font-size:13px;min-width:0;padding:5px 8px}.c64-cheat-error{color:#ff9a9a;font-size:12px;margin:8px 0 0}.c64-cheat-status{color:#aaa;font-size:12px;line-height:1.4;margin:8px 0 0}.c64-cheat-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}@media (max-width:600px){.c64-cheat-grid{grid-template-columns:1fr}.c64-cheat-grid label{margin-top:4px}}
`;

export interface UIControllerOptions {
  assetBaseUrl?: string;
  appVersion?: string;
  gitHash?: string;
  changelogUrl?: string;
}

function resolveAssetUrl(baseUrl: string | undefined, path: string): string {
  const base = baseUrl ?? '/';
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

const CONTROLS = [
  ['Move Up', '↑'],
  ['Move Down', '↓'],
  ['Move Left', '←'],
  ['Move Right', '→'],
  ['Fire', 'Z or Left Ctrl'],
];

const SPECIAL_KEYS = [
  ['Fast-forward speed', 'Alt + / Alt - / Alt Backspace'],
  ['Run/Stop', 'Esc'],
  ['Restore', '(currently unsupported)'],
  ['Insert/Delete', 'Backspace or Delete'],
  ['Clear/Home', 'Home'],
  ['Commodore', 'Ctrl or Caps Lock'],
  ['Control', 'Tab'],
  ['Arrow Left glyph', '`'],
  ['Arrow Up glyph', '^ or ~'],
  ['Pound', '\\'],
  ['Colon / Semicolon', ': ; [ ]'],
  ['Slash', '/ ?'],
  ['Comma / Period', ', . < >'],
  ['C64 function keys', 'F1-F8'],
];

import type { C64Player } from './c64-player';
import type { JoystickPort } from '../emulator/constants';
import { chooseAndStoreCheevosRom, storeCheevosRomFile } from './local-rom-store';
import { toViteFsUrl } from './startup-params';
import {
  LOAD_FORMAT_OPTIONS,
  getAcceptForLoadTypeSelection,
  getLoadTypeLabel,
  inferLoadTypeFromFilename,
  isSupportedLoadType,
  resolveLoadTypeSelection,
  type LoadType,
  type LoadTypeSelection,
} from './load-formats';

const CRT_PRELOAD_CHECKS_STORAGE_KEY = 'c64-disable-crt-preload-checks';
const CHEEVOS_DETECTOR_STORAGE_KEY = 'c64-cheevos-dev-detector';
const CHEEVOS_JSON_PATH_STORAGE_KEY = 'c64-cheevos-dev-json-path';
const CHEEVOS_TRACKER_VISIBLE_STORAGE_KEY = 'c64-cheevos-tracker-visible';
const CHEAT_CONFIG_STORAGE_KEY = 'c64cade.cheatMode.v1';
const CHEAT_NOTICE_MS = 1800;

type CheatAction = 'increment' | 'decrement' | 'set';
type CheatKeyBinding = { code: string; key: string; label: string };
type CheatRow = {
  id: string;
  address: string;
  action: CheatAction;
  setValue: string;
  keyBinding: CheatKeyBinding | null;
};

const CHEAT_ACTIONS: Array<{ value: CheatAction; label: string }> = [
  { value: 'increment', label: 'Increment' },
  { value: 'decrement', label: 'Decrement' },
  { value: 'set', label: 'Set' },
];

type ConnectedGamepad = {
  index: number;
  name: string;
};

function formatSnapshotFilename(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `snapshot-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.c64`;
}

function createCheatRow(overrides: Partial<CheatRow> = {}): CheatRow {
  return {
    id: overrides.id ?? `cheat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    address: typeof overrides.address === 'string' ? overrides.address : '0x004e',
    action: CHEAT_ACTIONS.some((action) => action.value === overrides.action)
      ? (overrides.action as CheatAction)
      : 'increment',
    setValue: typeof overrides.setValue === 'string' ? overrides.setValue : '0xff',
    keyBinding: normaliseCheatKeyBinding(overrides.keyBinding),
  };
}

function normaliseCheatRow(value: unknown): CheatRow | null {
  if (!value || typeof value !== 'object') return null;
  return createCheatRow(value as Partial<CheatRow>);
}

function isCheatRow(row: CheatRow | null): row is CheatRow {
  return !!row;
}

function loadCheatConfig(): CheatRow[] {
  const fallback = [createCheatRow()];
  try {
    const raw = localStorage.getItem(CHEAT_CONFIG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const rows = Array.isArray(parsed?.cheats)
      ? (parsed.cheats as unknown[]).map(normaliseCheatRow).filter(isCheatRow)
      : [normaliseCheatRow(parsed)].filter(isCheatRow);
    return rows.length ? rows : fallback;
  } catch (error) {
    console.warn('Failed to load cheat config:', error);
    return fallback;
  }
}

function getNextCheatId(rows: CheatRow[]): number {
  return rows.reduce((nextId, cheat) => {
    const match = String(cheat.id).match(/^cheat-(\d+)$/);
    return match ? Math.max(nextId, Number(match[1]) + 1) : nextId;
  }, 1);
}

function parseC64Address(value: string): number | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw.startsWith('$') ? raw.slice(1) : raw;
  if (!/^[0-9a-f]{1,4}$/.test(hex)) return null;
  const address = Number.parseInt(hex, 16);
  return Number.isInteger(address) && address >= 0 && address <= 0xffff ? address : null;
}

function parseCheatByte(value: string): number | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw.startsWith('$') ? raw.slice(1) : raw;
  if (!/^[0-9a-f]{1,2}$/.test(hex)) return null;
  const byte = Number.parseInt(hex, 16);
  return Number.isInteger(byte) && byte >= 0 && byte <= 0xff ? byte : null;
}

function formatHexByte(value: number): string {
  return `0x${(value & 0xff).toString(16).padStart(2, '0')}`;
}

function formatHexAddress(value: number): string {
  return `0x${(value & 0xffff).toString(16).padStart(4, '0')}`;
}

function normaliseCheatKeyBinding(binding: unknown): CheatKeyBinding | null {
  if (!binding || typeof binding !== 'object' || !('code' in binding)) return null;
  const value = binding as Partial<CheatKeyBinding>;
  if (!value.code) return null;
  return {
    code: String(value.code),
    key: String(value.key || value.code),
    label: String(value.label || labelForKey(value.key, value.code)),
  };
}

function keyBindingFromEvent(event: KeyboardEvent): CheatKeyBinding {
  return {
    code: event.code || event.key,
    key: event.key,
    label: labelForKey(event.key, event.code),
  };
}

function labelForKey(key?: string, code?: string): string {
  if (code === 'ControlLeft') return 'Left Ctrl';
  if (code === 'ControlRight') return 'Right Ctrl';
  if (key === ' ') return 'Space';
  if (key?.startsWith('Arrow')) return key.replace('Arrow', 'Arrow ');
  if (/^Key[A-Z]$/.test(code || '')) return (code || '').slice(3);
  if (/^Digit[0-9]$/.test(code || '')) return (code || '').slice(5);
  return key || code || '';
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tagName = element?.tagName?.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'select' ||
    tagName === 'textarea' ||
    !!element?.isContentEditable
  );
}

function formatRamDumpFilename(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}z$/i, 'z');
  return `c64-ready-${stamp}-ram.bin`;
}

export default class UIController {
  private static activeController: UIController | null = null;
  private helpOverlay: HTMLElement | null = null;
  private settingsOverlay: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private player: C64Player | null = null;
  private readonly options: UIControllerOptions;
  private cheats: CheatRow[] = loadCheatConfig();
  private recordingCheatId: string | null = null;
  private nextCheatId = getNextCheatId(this.cheats);
  private cheatStatus = '';
  private cheatNoticeTimer: number | null = null;
  private readonly handleCheatKeyDown = (event: KeyboardEvent): void => {
    if (UIController.activeController !== this) return;
    if (this.recordingCheatId || event.repeat || isEditableKeyTarget(event.target)) return;
    const cheat = this.cheats.find((entry) => this.matchesCheatKey(event, entry));
    if (!cheat) return;
    event.preventDefault();
    event.stopPropagation();
    this.applyCheatAction(cheat);
  };
  // Save previous overflow styles so we can restore them when exiting full/stretch
  private savedHtmlOverflow: string | null = null;
  private savedBodyOverflow: string | null = null;
  private connectedGamepads = new Map<number, ConnectedGamepad>();
  private readonly handleControllerConnected = (event: Event): void => {
    const detail = (event as CustomEvent<{ name?: string; index?: number }>).detail;
    if (typeof detail?.index !== 'number') return;
    this.connectedGamepads.set(detail.index, {
      index: detail.index,
      name: detail.name ?? `Gamepad ${detail.index}`,
    });
    this.renderGamepadButtons();
  };
  private readonly handleControllerDisconnected = (event: Event): void => {
    const detail = (event as CustomEvent<{ index?: number }>).detail;
    if (typeof detail?.index !== 'number') return;
    this.connectedGamepads.delete(detail.index);
    this.renderGamepadButtons();
  };

  constructor(options: UIControllerOptions = {}) {
    this.options = options;
  }

  init(player?: C64Player): void {
    UIController.activeController = this;
    this.player = player ?? null;
    this.syncConnectedGamepads();
    this.injectCSS();
    this.createButton();
    this.createDialog();
    this.createHamburger();
    this.createMenu();
    this.createUnmuteButton();
    window.addEventListener('keydown', this.handleCheatKeyDown, true);
    window.addEventListener('c64-controller-connected', this.handleControllerConnected);
    window.addEventListener('c64-controller-disconnected', this.handleControllerDisconnected);
  }

  private syncConnectedGamepads(): void {
    this.connectedGamepads.clear();
    const gamepads = navigator.getGamepads?.() ?? [];
    for (const gamepad of gamepads) {
      if (!gamepad) continue;
      this.connectedGamepads.set(gamepad.index, {
        index: gamepad.index,
        name: gamepad.id,
      });
    }
  }

  private getConnectedGamepads(): ConnectedGamepad[] {
    return Array.from(this.connectedGamepads.values()).sort((a, b) => a.index - b.index);
  }

  private getGamepadLabel(gamepad: ConnectedGamepad): string {
    const shortenedName = gamepad.name.replace(/\s*\([^)]*\)\s*$/u, '').trim();
    const name = shortenedName || gamepad.name.trim() || `Gamepad ${gamepad.index}`;
    return `${gamepad.index}: ${name}`;
  }

  private renderGamepadButtons(): void {
    const container = document.getElementById('c64-gamepad-list');
    const emptyState = document.getElementById('c64-gamepad-empty');
    if (!container || !emptyState) return;

    const gamepads = this.getConnectedGamepads();
    const activeIndex = this.player?.getActiveGamepadIndex() ?? -1;

    container.replaceChildren(
      ...gamepads.map((gamepad) => {
        const button = document.createElement('button');
        const active = gamepad.index === activeIndex;
        button.type = 'button';
        button.className = `c64-btn c64-gamepad-btn${active ? ' active' : ''}`;
        button.textContent = this.getGamepadLabel(gamepad);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.addEventListener('click', () => {
          if (!this.player) return;
          this.player.setActiveGamepadIndex(gamepad.index);
          this.renderGamepadButtons();
        });
        return button;
      }),
    );

    emptyState.hidden = gamepads.length > 0;
  }

  private downloadSnapshot(snapshot: Uint8Array<ArrayBufferLike>): void {
    const snapshotCopy = new Uint8Array(snapshot.byteLength);
    snapshotCopy.set(snapshot);
    const blob = new Blob([snapshotCopy], { type: 'application/bin' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = formatSnapshotFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private downloadBytes(filename: string, bytes: Uint8Array): void {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private promptForCheevosJsonUrl(
    file: File,
    detectorInput: HTMLInputElement | null,
    status: HTMLElement,
  ): void {
    const fileWithPath = file as File & { path?: string; webkitRelativePath?: string };
    const inferredPath = fileWithPath.path || fileWithPath.webkitRelativePath || '';
    if (inferredPath) {
      this.updateCheevosJsonUrl(inferredPath, file.name, detectorInput, status);
      return;
    }
    const previousPath = localStorage.getItem(CHEEVOS_JSON_PATH_STORAGE_KEY) ?? '';
    const path = window.prompt(
      'Optional: enter the absolute path to this cheevos JSON to update the URL for refresh.',
      previousPath,
    );
    if (!path?.trim()) return;

    this.updateCheevosJsonUrl(path, file.name, detectorInput, status);
  }

  private updateCheevosJsonUrl(
    path: string,
    filename: string,
    detectorInput: HTMLInputElement | null,
    status: HTMLElement,
  ): void {
    const cheevosSet = toViteFsUrl(path, this.options.assetBaseUrl ?? '/');
    if (!cheevosSet) return;

    localStorage.setItem(CHEEVOS_JSON_PATH_STORAGE_KEY, path.trim());
    const searchParams = new URLSearchParams(window.location.search);
    const detectorId = detectorInput?.value.trim() ?? '';
    if (detectorId) searchParams.set('cheevos', detectorId);
    searchParams.set('cheevosSet', cheevosSet);
    if (!searchParams.has('game')) searchParams.delete('game');
    const search = searchParams.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
    );
    status.textContent = `Loaded JSON from ${filename}; updated URL cheevosSet=${cheevosSet}`;
  }

  private saveCheatConfig(): void {
    localStorage.setItem(
      CHEAT_CONFIG_STORAGE_KEY,
      JSON.stringify({
        cheats: this.cheats.map((cheat) => ({
          id: cheat.id,
          address: cheat.address,
          action: cheat.action,
          setValue: cheat.setValue,
          keyBinding: cheat.keyBinding,
        })),
      }),
    );
  }

  private getCheatAddressError(cheat: CheatRow): string {
    if (!cheat.address.trim()) return 'Enter a C64 memory address.';
    if (parseC64Address(cheat.address) === null)
      return 'Use a valid address from 0x0000 to 0xffff.';
    return '';
  }

  private getCheatSetValueError(cheat: CheatRow): string {
    if (cheat.action !== 'set') return '';
    if (!cheat.setValue.trim()) return 'Enter a byte value to set.';
    if (parseCheatByte(cheat.setValue) === null) return 'Use a valid byte value from 0x00 to 0xff.';
    return '';
  }

  private isCheatReady(cheat: CheatRow): boolean {
    return (
      !this.getCheatAddressError(cheat) &&
      !this.getCheatSetValueError(cheat) &&
      !!cheat.keyBinding?.code
    );
  }

  private matchesCheatKey(event: KeyboardEvent, cheat: CheatRow): boolean {
    const binding = cheat.keyBinding;
    if (!binding?.code || !this.isCheatReady(cheat)) return false;
    if (event.code === binding.code) return true;
    return !!binding.key && event.key?.toLowerCase() === binding.key.toLowerCase();
  }

  private setCheatStatus(message: string): void {
    this.cheatStatus = message;
    const status = document.getElementById('c64-cheat-status') as HTMLElement | null;
    if (status) {
      status.textContent = message;
      status.hidden = !message;
    }

    if (this.cheatNoticeTimer !== null) window.clearTimeout(this.cheatNoticeTimer);
    this.cheatNoticeTimer = window.setTimeout(() => {
      this.cheatNoticeTimer = null;
    }, CHEAT_NOTICE_MS);
  }

  private applyCheatAction(cheat: CheatRow): void {
    const address = parseC64Address(cheat.address);
    if (address === null) {
      this.setCheatStatus(this.getCheatAddressError(cheat));
      return;
    }

    const setValue = cheat.action === 'set' ? parseCheatByte(cheat.setValue) : null;
    if (cheat.action === 'set' && setValue === null) {
      this.setCheatStatus(this.getCheatSetValueError(cheat));
      return;
    }

    if (
      !this.player ||
      typeof this.player.cpuRead !== 'function' ||
      typeof this.player.cpuWrite !== 'function'
    ) {
      this.setCheatStatus('Emulator memory is not ready yet.');
      return;
    }

    const currentValue = this.player.cpuRead(address) & 0xff;
    const nextValue =
      cheat.action === 'set'
        ? (setValue as number)
        : cheat.action === 'decrement'
          ? (currentValue + 0xff) & 0xff
          : (currentValue + 1) & 0xff;

    this.player.cpuWrite(address, nextValue);
    const actionLabel =
      CHEAT_ACTIONS.find((action) => action.value === cheat.action)?.label ?? 'Updated';
    this.setCheatStatus(
      `${actionLabel} ${formatHexAddress(address)}: ${formatHexByte(currentValue)} -> ${formatHexByte(nextValue)}`,
    );
  }

  private addCheat(): void {
    this.cheats = [
      ...this.cheats,
      createCheatRow({ id: `cheat-${this.nextCheatId++}`, address: '' }),
    ];
    this.saveCheatConfig();
    this.renderCheats();
  }

  private removeCheat(cheatId: string): void {
    if (this.cheats.length <= 1) return;
    this.cheats = this.cheats.filter((cheat) => cheat.id !== cheatId);
    if (this.recordingCheatId === cheatId) this.recordingCheatId = null;
    this.saveCheatConfig();
    this.renderCheats();
  }

  private renderCheats(): void {
    const list = document.getElementById('c64-cheat-list');
    if (!list) return;

    list.replaceChildren(
      ...this.cheats.map((cheat, index) => {
        const card = document.createElement('article');
        card.className = 'c64-cheat-card';
        card.addEventListener('keydown', (event) => event.stopPropagation());
        card.addEventListener('keyup', (event) => event.stopPropagation());

        const header = document.createElement('div');
        header.className = 'c64-cheat-card-header';
        const title = document.createElement('span');
        title.textContent = `Cheat ${index + 1}`;
        header.appendChild(title);
        if (this.cheats.length > 1) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'c64-cheat-remove';
          remove.textContent = 'Remove';
          remove.addEventListener('click', () => this.removeCheat(cheat.id));
          header.appendChild(remove);
        }

        const grid = document.createElement('div');
        grid.className = 'c64-cheat-grid';

        const addressInput = document.createElement('input');
        addressInput.id = `c64-cheat-address-${cheat.id}`;
        addressInput.className = 'c64-cheat-input';
        addressInput.type = 'text';
        addressInput.inputMode = 'text';
        addressInput.spellcheck = false;
        addressInput.autocomplete = 'off';
        addressInput.placeholder = '0x004e';
        addressInput.value = cheat.address;
        addressInput.addEventListener('input', () => {
          cheat.address = addressInput.value;
          this.saveCheatConfig();
        });
        grid.appendChild(this.makeLabel(addressInput.id, 'Memory address'));
        grid.appendChild(addressInput);

        const actionSelect = document.createElement('select');
        actionSelect.id = `c64-cheat-action-${cheat.id}`;
        actionSelect.className = 'c64-cheat-input';
        for (const action of CHEAT_ACTIONS) {
          const option = document.createElement('option');
          option.value = action.value;
          option.textContent = action.label;
          option.selected = cheat.action === action.value;
          actionSelect.appendChild(option);
        }
        actionSelect.addEventListener('change', () => {
          cheat.action = actionSelect.value as CheatAction;
          this.saveCheatConfig();
          this.renderCheats();
        });
        grid.appendChild(this.makeLabel(actionSelect.id, 'Action'));
        grid.appendChild(actionSelect);

        if (cheat.action === 'set') {
          const setInput = document.createElement('input');
          setInput.id = `c64-cheat-set-value-${cheat.id}`;
          setInput.className = 'c64-cheat-input';
          setInput.type = 'text';
          setInput.inputMode = 'text';
          setInput.spellcheck = false;
          setInput.autocomplete = 'off';
          setInput.placeholder = '0xff';
          setInput.value = cheat.setValue;
          setInput.addEventListener('input', () => {
            cheat.setValue = setInput.value;
            this.saveCheatConfig();
          });
          grid.appendChild(this.makeLabel(setInput.id, 'Set value'));
          grid.appendChild(setInput);
        }

        const keyButton = document.createElement('button');
        keyButton.id = `c64-cheat-key-${cheat.id}`;
        keyButton.type = 'button';
        keyButton.className = `c64-btn${this.recordingCheatId === cheat.id ? ' active' : ''}`;
        keyButton.textContent =
          this.recordingCheatId === cheat.id
            ? 'Press a key...'
            : (cheat.keyBinding?.label ?? 'Choose key...');
        keyButton.addEventListener('click', () => {
          this.recordingCheatId = cheat.id;
          this.renderCheats();
          document.getElementById(keyButton.id)?.focus();
        });
        keyButton.addEventListener('keydown', (event) => {
          if (this.recordingCheatId !== cheat.id) return;
          event.preventDefault();
          event.stopPropagation();
          cheat.keyBinding = keyBindingFromEvent(event);
          this.recordingCheatId = null;
          this.saveCheatConfig();
          this.renderCheats();
        });
        grid.appendChild(this.makeLabel(keyButton.id, 'Key press'));
        grid.appendChild(keyButton);

        const actions = document.createElement('div');
        actions.className = 'c64-cheat-actions';
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'c64-btn';
        apply.textContent = 'Apply Now';
        apply.disabled = !this.isCheatReady(cheat);
        apply.addEventListener('click', () => this.applyCheatAction(cheat));
        actions.appendChild(apply);
        if (this.recordingCheatId === cheat.id) {
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'c64-btn';
          cancel.textContent = 'Cancel Key';
          cancel.addEventListener('click', () => {
            this.recordingCheatId = null;
            this.renderCheats();
          });
          actions.appendChild(cancel);
        }
        if (cheat.keyBinding) {
          const clear = document.createElement('button');
          clear.type = 'button';
          clear.className = 'c64-btn';
          clear.textContent = 'Clear Key';
          clear.addEventListener('click', () => {
            cheat.keyBinding = null;
            this.saveCheatConfig();
            this.renderCheats();
          });
          actions.appendChild(clear);
        }

        const error = this.getCheatAddressError(cheat) || this.getCheatSetValueError(cheat);
        card.appendChild(header);
        card.appendChild(grid);
        card.appendChild(actions);
        if (error) {
          const errorEl = document.createElement('p');
          errorEl.className = 'c64-cheat-error';
          errorEl.textContent = error;
          card.appendChild(errorEl);
        }
        return card;
      }),
    );

    const status = document.getElementById('c64-cheat-status') as HTMLElement | null;
    if (status) {
      status.textContent = this.cheatStatus;
      status.hidden = !this.cheatStatus;
    }
  }

  private makeLabel(htmlFor: string, text: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.htmlFor = htmlFor;
    label.textContent = text;
    return label;
  }

  private dumpC64Ram(): void {
    if (!this.player || typeof this.player.ramRead !== 'function') {
      this.setCheatStatus('Emulator RAM is not ready yet.');
      return;
    }

    try {
      const bytes = new Uint8Array(0x10000);
      for (let address = 0; address <= 0xffff; address += 1) {
        bytes[address] = this.player.ramRead(address) & 0xff;
      }
      const filename = formatRamDumpFilename();
      this.downloadBytes(filename, bytes);
      this.setCheatStatus(`Dumped 64K RAM to ${filename}`);
    } catch (error) {
      this.setCheatStatus(error instanceof Error ? error.message : 'Failed to dump C64 RAM.');
    }
  }

  private injectCSS(): void {
    if (document.querySelector('style[data-c64-help]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-c64-help', '');
    style.textContent = css;
    document.head.appendChild(style);
  }

  private getVersionLabel(): string {
    const version = this.options.appVersion ?? '0.0.0';
    const gitHash = this.options.gitHash;
    return `v${version}${gitHash ? ` (build: ${gitHash})` : ''}`;
  }

  private createButton(): void {
    const btn = document.createElement('button');
    btn.className = 'c64-help-btn';
    btn.textContent = '?';
    btn.title = 'Help';
    btn.addEventListener('click', () => this.open());
    document.body.appendChild(btn);
  }

  private createDialog(): void {
    const overlay = document.createElement('div');
    overlay.className = 'c64-help-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    const controlItems = CONTROLS.map(
      ([action, key]) => `<li><span>${action}</span><span class="c64-help-key">${key}</span></li>`,
    ).join('');

    const specialItems = SPECIAL_KEYS.map(
      ([action, key]) => `<li><span>${action}</span><span class="c64-help-key">${key}</span></li>`,
    ).join('');

    overlay.innerHTML = `
      <div class="c64-help-dialog">
        <button class="c64-help-close">&times;</button>
        <h2>C64 READY</h2>
        <p>A Commodore 64 emulator running in the browser via WebAssembly.</p>
        <p><a href="https://github.com/hayesmaker/c64-ready" target="_blank" rel="noopener">Source code on GitHub</a> · <a href="#" id="c64-view-changelog">View changelog</a></p>
        <h2>CONTROLS</h2>
        <ul class="c64-help-controls">${controlItems}</ul>
        <h2>SPECIAL KEYS</h2>
        <ul class="c64-help-special">${specialItems}</ul>
        <div class="c64-version">${this.getVersionLabel()}</div>
      </div>
    `;

    overlay.querySelector('.c64-help-close')!.addEventListener('click', () => this.close());

    document.body.appendChild(overlay);
    this.helpOverlay = overlay;
    // Create changelog modal container (hidden by default)
    const changelogOverlay = document.createElement('div');
    changelogOverlay.className = 'c64-help-overlay';
    changelogOverlay.style.zIndex = '1003';
    changelogOverlay.innerHTML = `
      <div class="c64-help-dialog c64-changelog-dialog">
        <button class="c64-help-close">&times;</button>
        <h2>CHANGELOG</h2>
        <div id="c64-changelog-content">Loading...</div>
      </div>
    `;
    changelogOverlay
      .querySelector('.c64-help-close')!
      .addEventListener('click', () => changelogOverlay.classList.remove('visible'));
    document.body.appendChild(changelogOverlay);
    // Wire the changelog link
    const changelogLink = overlay.querySelector('#c64-view-changelog') as HTMLAnchorElement | null;
    if (changelogLink) {
      changelogLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        // Load changelog content (bundled via raw import if available)
        this.loadAndShowChangelog(changelogOverlay);
      });
    }
  }

  private async loadAndShowChangelog(container: HTMLElement) {
    container.classList.add('visible');
    try {
      const res = await fetch(
        this.options.changelogUrl ?? resolveAssetUrl(this.options.assetBaseUrl, 'CHANGELOG.md'),
        {
          cache: 'no-store',
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();

      // Filter: keep headers, blank lines, and only feat:/fix: bullet lines
      const filtered = raw
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          // Keep headings, blank lines, and non-list-item lines (e.g. intro text)
          if (!trimmed.startsWith('- ')) return true;
          // Keep only feat: and fix: entries
          return /^- (feat|fix)[:(]/.test(trimmed);
        })
        .join('\n');

      const [{ marked }, DOMPurify] = await Promise.all([import('marked'), import('dompurify')]);
      const html = DOMPurify.default.sanitize(marked.parse(filtered));
      const el = container.querySelector('#c64-changelog-content')!;
      el.innerHTML = html;
    } catch {
      const el = container.querySelector('#c64-changelog-content')!;
      el.innerHTML = '<p>No changelog found.</p>';
    }
  }

  private createHamburger(): void {
    const btn = document.createElement('button');
    btn.className = 'c64-hamburger';
    btn.innerHTML = '&#9776;';
    btn.title = 'Menu';
    btn.addEventListener('click', () => this.toggleMenu());
    document.body.appendChild(btn);
  }

  private createMenu(): void {
    const overlay = document.createElement('div');
    overlay.className = 'c64-menu-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeMenu();
    });

    const sections = [
      { id: 'load', label: 'Load' },
      { id: 'input', label: 'Input' },
      { id: 'display', label: 'Display' },
      { id: 'audio', label: 'Audio' },
      { id: 'cheevos', label: 'Cheevos' },
      { id: 'cheats', label: 'Cheats' },
      { id: 'system', label: 'System' },
    ] as const;

    const loadTypeOptions = LOAD_FORMAT_OPTIONS.map(
      (format) => `<option value="${format.type}">${format.label}</option>`,
    ).join('');

    const panel = document.createElement('div');
    panel.className = 'c64-menu-panel';
    panel.innerHTML = `
      <div class="c64-menu-header">
        <h2>Settings</h2>
        <button class="c64-menu-close">&times;</button>
      </div>
      <div class="c64-menu-body">
        <div class="c64-settings-tabs" role="tablist" aria-label="Settings sections">
          ${sections
            .map(
              (section, i) =>
                `<button class="c64-settings-tab${i === 0 ? ' active' : ''}" data-settings-tab="${section.id}" role="tab" aria-selected="${
                  i === 0 ? 'true' : 'false'
                }">${section.label}</button>`,
            )
            .join('')}
        </div>

        <div class="c64-settings-sections">
          <section class="c64-settings-section" data-settings-section="load">
            <label class="c64-section-label">Load Game</label>
            <div class="c64-form-row">
              <label for="c64-load-format">Format</label>
              <select id="c64-load-format" class="c64-select">
                <option value="auto">Auto detect (recommended)</option>
                ${loadTypeOptions}
              </select>
            </div>
            <div class="c64-dragarea" id="c64-dragarea">
              <span id="c64-dragarea-copy">Drop a game file here or</span>
              <button class="c64-btn" id="c64-browse">Browse</button>
            </div>
            <input class="c64-file-input" id="c64-file-input" type="file" />
            <div class="c64-cart-preview" id="c64-cart-preview" hidden>
              <div class="c64-cart-icon" id="c64-cart-icon" aria-hidden="true">
                <svg width="48" height="32" viewBox="0 0 48 32" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="44" height="24" rx="3" fill="#222" stroke="#555"/><rect x="6" y="8" width="36" height="12" fill="#2b2b3d"/></svg>
              </div>
              <div>
                <div class="c64-cart-filename" id="c64-cart-filename"></div>
                <div class="c64-cart-type" id="c64-cart-type"></div>
              </div>
            </div>
            <div class="c64-menu-actions">
              <button class="c64-btn" id="c64-load-btn">Load</button>
              <button class="c64-btn" id="c64-close-menu">Close</button>
            </div>
            <div class="c64-tools-section">
              <label class="c64-section-label">Tools</label>
              <div class="c64-form-row">
                <select id="c64-tool-select" class="c64-select c64-tool-select" disabled>
                  <option value="">No tools found</option>
                </select>
                <button class="c64-btn" id="c64-load-tool-btn" disabled>Load Tool</button>
              </div>
              <div class="c64-section-hint" id="c64-tools-status">Loading tools…</div>
            </div>
          </section>

          <section class="c64-settings-section" data-settings-section="input" hidden>
            <label class="c64-section-label">Input Port</label>
            <div class="c64-radio-row">
              <label><input type="radio" name="c64-joy-port" value="1" /> Port 1</label>
              <label><input type="radio" name="c64-joy-port" value="2" checked /> Port 2</label>
            </div>
            <label class="c64-section-label">Input Mode</label>
            <div class="c64-radio-row c64-radio-row-wrap">
              <label><input type="radio" name="c64-input-mode" value="joystick" /> Joystick</label>
              <label><input type="radio" name="c64-input-mode" value="keyboard" /> Keyboard</label>
              <label><input type="radio" name="c64-input-mode" value="mixed" checked /> Mixed</label>
            </div>
            <div id="c64-input-mode-hint" class="c64-section-hint">Arrows + Z + Ctrl = joystick &amp; all other keys &rarr; C64 keyboard</div>
            <label class="c64-section-label">Gamepads</label>
            <div id="c64-gamepad-list" class="c64-gamepad-list"></div>
            <div id="c64-gamepad-empty" class="c64-section-hint">To use a gamepad, connect it to your computer and press any button.</div>
          </section>

          <section class="c64-settings-section" data-settings-section="display" hidden>
            <label class="c64-section-label">Display Mode</label>
            <div class="c64-radio-row">
              <label><input type="radio" name="c64-display-mode" value="standard" checked /> Standard</label>
              <label><input type="radio" name="c64-display-mode" value="full" /> Full</label>
              <label><input type="radio" name="c64-display-mode" value="stretch" /> Stretch</label>
            </div>
          </section>

          <section class="c64-settings-section" data-settings-section="audio" hidden>
            <div id="c64-audio-section-anchor"></div>
          </section>

          <section class="c64-settings-section" data-settings-section="cheevos" hidden>
            <label class="c64-section-label">Cheevos Dev</label>
            <div class="c64-section-hint">Load a c64-cheevos detector and optional achievement set JSON for local development.</div>
            <div class="c64-form-row">
              <label for="c64-cheevos-detector">Detector ID</label>
              <input id="c64-cheevos-detector" class="c64-text-input" type="text" placeholder="uridium" />
            </div>
            <div class="c64-form-row">
              <button class="c64-btn" id="c64-cheevos-browse-json-btn" type="button">Load JSON File</button>
              <span class="c64-inline-status" id="c64-cheevos-json-filename">No JSON file loaded</span>
              <input id="c64-cheevos-json-file" class="c64-cheevos-json-file" type="file" accept="application/json,.json" />
            </div>
            <textarea id="c64-cheevos-json" class="c64-textarea" spellcheck="false" placeholder='{ "_id": "set1", "cheevos": [{ "_id": "zinc", "title": "Zinc", "description": "Clear level 1" }] }'></textarea>
            <div class="c64-menu-actions">
              <button class="c64-btn" id="c64-cheevos-enable-btn">Enable</button>
              <button class="c64-btn" id="c64-cheevos-disable-btn">Disable</button>
              <button class="c64-btn" id="c64-cheevos-choose-rom-btn" type="button" disabled>Choose ROM File</button>
              <button class="c64-btn" id="c64-cheevos-clear-popped-btn">Clear Unlocks</button>
              <button class="c64-btn" id="c64-cheevos-clear-scores-btn">Clear Scores</button>
            </div>
            <input id="c64-cheevos-rom-file" class="c64-cheevos-json-file" type="file" accept=".crt,.prg,.d64" />
            <label class="c64-checkbox-row" for="c64-cheevos-tracker-visible">
              <input type="checkbox" id="c64-cheevos-tracker-visible" />
              Show tracker panel
            </label>
            <div class="c64-section-hint">Shows the cheevos tracker beside the emulator in Standard display mode.</div>
            <div class="c64-section-hint" id="c64-cheevos-status">Cheevos dev tracking is disabled.</div>
          </section>

          <section class="c64-settings-section" data-settings-section="cheats" hidden>
            <label class="c64-section-label">Cheat Mode</label>
            <div class="c64-section-hint">Bind keys to change C64 memory bytes while the game is running. Values wrap between 0x00 and 0xff.</div>
            <div class="c64-cheat-list" id="c64-cheat-list"></div>
            <div class="c64-menu-actions">
              <button class="c64-btn" id="c64-add-cheat-btn" type="button">Add Cheat</button>
            </div>
            <div class="c64-tools-section">
              <label class="c64-section-label">Memory Tools</label>
              <div class="c64-menu-actions">
                <button class="c64-btn" id="c64-dump-ram-btn" type="button">Dump 64K RAM</button>
              </div>
              <div class="c64-section-hint">Downloads raw C64 RAM from $0000-$ffff as a .bin file for address inspection.</div>
              <div class="c64-cheat-status" id="c64-cheat-status" hidden></div>
            </div>
          </section>

          <section class="c64-settings-section" data-settings-section="system" hidden>
            <label class="c64-section-label">System Actions</label>
            <div class="c64-system-actions">
              <button class="c64-btn" id="c64-save-snapshot-btn">Save Snapshot</button>
              <button class="c64-btn" id="c64-detach-btn">Detach Cartridge</button>
              <button class="c64-btn" id="c64-reset-btn">Hard Reset</button>
              <button class="c64-btn" id="c64-reboot-btn">Reboot Emulator</button>
            </div>
            <label class="c64-checkbox-row" for="c64-disable-crt-preload-checks">
              <input type="checkbox" id="c64-disable-crt-preload-checks" />
              Disable crt preload checks
            </label>
            <div class="c64-section-hint">Allows any .crt file and skips compatibility prechecks.</div>
          </section>
        </div>
      </div>
    `;

    panel.querySelector('.c64-menu-close')!.addEventListener('click', () => this.closeMenu());
    panel.querySelector('#c64-close-menu')!.addEventListener('click', () => this.closeMenu());

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    // The settings overlay is the overlay we just created
    this.settingsOverlay = overlay;

    const tabButtons = panel.querySelectorAll(
      '[data-settings-tab]',
    ) as NodeListOf<HTMLButtonElement>;
    const sectionEls = panel.querySelectorAll('[data-settings-section]') as NodeListOf<HTMLElement>;

    const activateSection = (sectionId: string) => {
      tabButtons.forEach((tab) => {
        const active = tab.getAttribute('data-settings-tab') === sectionId;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      sectionEls.forEach((section) => {
        section.hidden = section.getAttribute('data-settings-section') !== sectionId;
      });
    };

    tabButtons.forEach((tab) => {
      tab.addEventListener('click', () => {
        const sectionId = tab.getAttribute('data-settings-tab');
        if (sectionId) activateSection(sectionId);
      });
    });

    // wire up file input and drag/drop
    this.fileInput = panel.querySelector('#c64-file-input') as HTMLInputElement;
    const dragarea = panel.querySelector('#c64-dragarea') as HTMLElement;
    const dragareaCopy = panel.querySelector('#c64-dragarea-copy') as HTMLElement;
    const browse = panel.querySelector('#c64-browse') as HTMLButtonElement;
    const loadTypeSelect = panel.querySelector('#c64-load-format') as HTMLSelectElement;
    const toolSelect = panel.querySelector('#c64-tool-select') as HTMLSelectElement;
    const loadToolBtn = panel.querySelector('#c64-load-tool-btn') as HTMLButtonElement;
    const toolsStatus = panel.querySelector('#c64-tools-status') as HTMLElement;
    const preview = panel.querySelector('#c64-cart-preview') as HTMLElement;
    const previewName = panel.querySelector('#c64-cart-filename') as HTMLElement;
    const previewType = panel.querySelector('#c64-cart-type') as HTMLElement;

    const updateLoadChooser = () => {
      const selection = (loadTypeSelect.value as LoadTypeSelection) ?? 'auto';
      this.fileInput!.accept = getAcceptForLoadTypeSelection(selection);
      if (selection === 'auto') {
        dragareaCopy.textContent = 'Drop a game file here or';
      } else {
        dragareaCopy.textContent = `Drop a ${getLoadTypeLabel(selection)} file here or`;
      }
    };
    updateLoadChooser();
    loadTypeSelect.addEventListener('change', updateLoadChooser);

    const handleFile = (file: File) => {
      const selection = (loadTypeSelect.value as LoadTypeSelection) ?? 'auto';
      const loadType = resolveLoadTypeSelection(selection, file.name);
      preview.hidden = false;
      previewName.textContent = file.name;
      previewType.textContent = getLoadTypeLabel(loadType);
      // dispatch event for main code to pick up
      const ev = new CustomEvent('c64-load-file', { detail: { file, type: loadType } });
      window.dispatchEvent(ev);
    };

    dragarea.addEventListener('dragover', (e) => {
      e.preventDefault();
      dragarea.classList.add('dragover');
    });
    dragarea.addEventListener('dragleave', () => {
      dragarea.classList.remove('dragover');
    });
    dragarea.addEventListener('drop', (e) => {
      e.preventDefault();
      dragarea.classList.remove('dragover');
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    });

    browse.addEventListener('click', () => this.fileInput?.click());
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput?.files?.[0];
      if (f) handleFile(f);
    });

    panel.querySelector('#c64-load-btn')!.addEventListener('click', () => {
      // If a file is selected in preview, keep it; otherwise open file picker
      const f = this.fileInput?.files?.[0];
      if (f) handleFile(f);
      else this.fileInput?.click();
    });

    type ToolItem = { name: string; url: string; type: LoadType };
    let toolItems: ToolItem[] = [];

    const renderToolSelect = () => {
      toolSelect.innerHTML = '';
      if (toolItems.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No tools found';
        toolSelect.appendChild(opt);
        toolSelect.disabled = true;
        loadToolBtn.disabled = true;
        return;
      }
      toolItems.forEach((tool, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = tool.name;
        toolSelect.appendChild(opt);
      });
      toolSelect.disabled = false;
      loadToolBtn.disabled = false;
    };

    const parseManifest = (raw: unknown): ToolItem[] => {
      const entries: unknown[] = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { tools?: unknown[] }).tools)
          ? (raw as { tools: unknown[] }).tools
          : [];

      return entries
        .map((entry: unknown) => {
          const path =
            typeof entry === 'string'
              ? entry
              : entry && typeof entry === 'object'
                ? ((entry as { path?: unknown }).path as string | undefined)
                : undefined;
          if (!path || typeof path !== 'string') return null;
          const filename = path.split('/').pop() ?? path;
          const type = inferLoadTypeFromFilename(filename);
          if (!type) return null;
          const encodedPath = path
            .split('/')
            .map((part) => encodeURIComponent(part))
            .join('/');
          const normalizedPath = encodedPath.replace(/^\/+/, '');
          const url = resolveAssetUrl(this.options.assetBaseUrl, `tools/${normalizedPath}`);
          return { name: filename, url, type } satisfies ToolItem;
        })
        .filter((v: ToolItem | null): v is ToolItem => !!v);
    };

    const loadToolsManifest = async () => {
      try {
        const url = resolveAssetUrl(this.options.assetBaseUrl, 'tools/tools.json');
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        toolItems = parseManifest(raw);
        renderToolSelect();
        toolsStatus.textContent =
          toolItems.length > 0
            ? `Found ${toolItems.length} tool${toolItems.length === 1 ? '' : 's'} in /public/tools`
            : 'No compatible tools found in manifest';
      } catch (err) {
        toolItems = [];
        renderToolSelect();
        toolsStatus.textContent = `Unable to load tools manifest: ${String((err as Error)?.message ?? err)}`;
      }
    };

    loadToolBtn.addEventListener('click', () => {
      const idx = Number(toolSelect.value);
      if (!Number.isFinite(idx)) return;
      const tool = toolItems[idx];
      if (!tool) return;
      window.dispatchEvent(new CustomEvent('c64-load-tool', { detail: tool }));
    });

    loadToolsManifest().catch(() => {});

    const cheevosDetectorInput = panel.querySelector(
      '#c64-cheevos-detector',
    ) as HTMLInputElement | null;
    const cheevosJsonInput = panel.querySelector('#c64-cheevos-json') as HTMLTextAreaElement | null;
    const cheevosJsonFile = panel.querySelector(
      '#c64-cheevos-json-file',
    ) as HTMLInputElement | null;
    const cheevosBrowseJsonBtn = panel.querySelector(
      '#c64-cheevos-browse-json-btn',
    ) as HTMLButtonElement | null;
    const cheevosJsonFilename = panel.querySelector(
      '#c64-cheevos-json-filename',
    ) as HTMLElement | null;
    const cheevosStatus = panel.querySelector('#c64-cheevos-status') as HTMLElement | null;
    const cheevosTrackerVisibleInput = panel.querySelector(
      '#c64-cheevos-tracker-visible',
    ) as HTMLInputElement | null;
    const cheevosChooseRomBtn = panel.querySelector(
      '#c64-cheevos-choose-rom-btn',
    ) as HTMLButtonElement | null;
    const cheevosRomFile = panel.querySelector('#c64-cheevos-rom-file') as HTMLInputElement | null;
    let pendingCheevosRomPath = '';
    let pendingCheevosRomType: LoadType | undefined;
    const storedCheevosDetector = window.localStorage.getItem(CHEEVOS_DETECTOR_STORAGE_KEY) ?? '';
    if (cheevosDetectorInput) cheevosDetectorInput.value = storedCheevosDetector;
    const trackerVisible = window.localStorage.getItem(CHEEVOS_TRACKER_VISIBLE_STORAGE_KEY) !== '0';
    if (cheevosTrackerVisibleInput) {
      cheevosTrackerVisibleInput.checked = trackerVisible;
      window.dispatchEvent(
        new CustomEvent('c64-cheevos-tracker-toggle', { detail: { visible: trackerVisible } }),
      );
      cheevosTrackerVisibleInput.addEventListener('change', () => {
        const visible = cheevosTrackerVisibleInput.checked;
        window.localStorage.setItem(CHEEVOS_TRACKER_VISIBLE_STORAGE_KEY, visible ? '1' : '0');
        window.dispatchEvent(
          new CustomEvent('c64-cheevos-tracker-toggle', { detail: { visible } }),
        );
      });
    }

    cheevosBrowseJsonBtn?.addEventListener('click', () => {
      cheevosJsonFile?.click();
    });

    cheevosJsonFile?.addEventListener('change', async () => {
      const file = cheevosJsonFile.files?.[0];
      if (!file || !cheevosJsonInput || !cheevosStatus) return;
      try {
        cheevosJsonInput.value = await file.text();
        if (cheevosJsonFilename) cheevosJsonFilename.textContent = file.name;
        cheevosStatus.textContent = `Loaded JSON from ${file.name}`;
        this.promptForCheevosJsonUrl(file, cheevosDetectorInput, cheevosStatus);
      } catch (err) {
        cheevosStatus.textContent = `Unable to read JSON file: ${String((err as Error)?.message ?? err)}`;
      }
    });

    panel.querySelector('#c64-cheevos-enable-btn')?.addEventListener('click', () => {
      const detectorId = cheevosDetectorInput?.value.trim() ?? '';
      const jsonText = cheevosJsonInput?.value.trim() ?? '';
      if (!detectorId) {
        if (cheevosStatus) cheevosStatus.textContent = 'Enter a detector ID first.';
        return;
      }
      window.localStorage.setItem(CHEEVOS_DETECTOR_STORAGE_KEY, detectorId);
      window.dispatchEvent(
        new CustomEvent('c64-cheevos-enable', { detail: { detectorId, jsonText } }),
      );
      if (cheevosStatus) cheevosStatus.textContent = `Enabling ${detectorId}...`;
    });

    panel.querySelector('#c64-cheevos-disable-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('c64-cheevos-disable'));
      if (cheevosStatus) cheevosStatus.textContent = 'Cheevos dev tracking is disabled.';
    });

    const dispatchCheevosRomFile = (file: File, romPath: string, type?: LoadType) => {
      const resolvedType = type ?? inferLoadTypeFromFilename(file.name) ?? 'crt';
      window.dispatchEvent(
        new CustomEvent('c64-cheevos-rom-file', {
          detail: { file, type: resolvedType, romPath },
        }),
      );
      if (cheevosStatus) cheevosStatus.textContent = `Loading ROM ${file.name} for ${romPath}`;
    };

    cheevosChooseRomBtn?.addEventListener('click', async () => {
      if (!pendingCheevosRomPath) return;
      if ('showOpenFilePicker' in window) {
        try {
          const rom = await chooseAndStoreCheevosRom(pendingCheevosRomPath, pendingCheevosRomType);
          if (rom) dispatchCheevosRomFile(rom.file, rom.romPath, rom.type);
          return;
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return;
          if (cheevosStatus) {
            cheevosStatus.textContent = `Unable to remember ROM file: ${String((err as Error)?.message ?? err)}`;
          }
          return;
        }
      }
      cheevosRomFile?.click();
    });

    cheevosRomFile?.addEventListener('change', async () => {
      const file = cheevosRomFile.files?.[0];
      if (!file || !pendingCheevosRomPath) return;
      try {
        await storeCheevosRomFile(pendingCheevosRomPath, file, pendingCheevosRomType);
      } catch (err) {
        if (cheevosStatus) {
          cheevosStatus.textContent = `Unable to remember ROM file: ${String((err as Error)?.message ?? err)}`;
        }
      }
      dispatchCheevosRomFile(file, pendingCheevosRomPath, pendingCheevosRomType);
    });

    panel.querySelector('#c64-cheevos-clear-popped-btn')?.addEventListener('click', () => {
      window.dispatchEvent(
        new CustomEvent('c64-cheevos-clear-popped', {
          detail: { detectorId: cheevosDetectorInput?.value.trim() ?? '' },
        }),
      );
      if (cheevosStatus) cheevosStatus.textContent = 'Local unlocks cleared.';
    });

    panel.querySelector('#c64-cheevos-clear-scores-btn')?.addEventListener('click', () => {
      window.dispatchEvent(
        new CustomEvent('c64-cheevos-clear-scores', {
          detail: { detectorId: cheevosDetectorInput?.value.trim() ?? '' },
        }),
      );
      if (cheevosStatus) cheevosStatus.textContent = 'Local scores cleared.';
    });

    window.addEventListener('c64-cheevos-status', (event: Event) => {
      if (!cheevosStatus) return;
      const detail = (
        event as CustomEvent<{ detectorId?: string; status?: string; cheevosCount?: number }>
      ).detail;
      if (detail?.status === 'enabled') {
        cheevosStatus.textContent = `Tracking ${detail.detectorId ?? 'cheevos'} (${detail.cheevosCount ?? 0} achievements)`;
      }
    });

    window.addEventListener('c64-cheevos-json-loaded', (event: Event) => {
      const detail = (event as CustomEvent<{ jsonText?: string; source?: string }>).detail;
      if (!detail?.jsonText || !cheevosJsonInput) return;
      cheevosJsonInput.value = detail.jsonText;
      if (cheevosJsonFilename) cheevosJsonFilename.textContent = detail.source ?? 'URL-loaded JSON';
      if (cheevosStatus) cheevosStatus.textContent = `Loaded JSON from ${detail.source ?? 'URL'}`;
    });

    window.addEventListener('c64-cheevos-rom-needed', (event: Event) => {
      const detail = (event as CustomEvent<{ romPath?: string; type?: LoadType; reason?: string }>)
        .detail;
      pendingCheevosRomPath = detail?.romPath?.trim() ?? '';
      pendingCheevosRomType = isSupportedLoadType(detail?.type) ? detail.type : undefined;
      if (cheevosChooseRomBtn) cheevosChooseRomBtn.disabled = !pendingCheevosRomPath;
      if (cheevosStatus && pendingCheevosRomPath) {
        cheevosStatus.textContent = `${detail?.reason ?? 'Choose local ROM file'}: ${pendingCheevosRomPath}`;
      }
    });

    window.addEventListener('c64-cheevos-error', (event: Event) => {
      if (!cheevosStatus) return;
      const detail = (event as CustomEvent<{ error?: string }>).detail;
      cheevosStatus.textContent = `Cheevos error: ${detail?.error ?? 'Unknown error'}`;
    });

    panel.querySelector('#c64-add-cheat-btn')?.addEventListener('click', () => this.addCheat());
    panel.querySelector('#c64-dump-ram-btn')?.addEventListener('click', () => this.dumpC64Ram());
    this.renderCheats();

    const section = panel.querySelector('[data-settings-section="system"]');
    // Detach cartridge / hard reset controls
    const saveSnapshotBtn = section?.querySelector(
      '#c64-save-snapshot-btn',
    ) as HTMLButtonElement | null;
    const detachBtn = section?.querySelector('#c64-detach-btn') as HTMLButtonElement | null;
    const resetBtn = section?.querySelector('#c64-reset-btn') as HTMLButtonElement | null;
    const rebootBtn = section?.querySelector('#c64-reboot-btn') as HTMLButtonElement | null;
    const disableChecksToggle = section?.querySelector(
      '#c64-disable-crt-preload-checks',
    ) as HTMLInputElement | null;
    const disableCrtPreloadChecks =
      window.localStorage.getItem(CRT_PRELOAD_CHECKS_STORAGE_KEY) === '1';
    this.player?.setCrtPreloadChecksDisabled(disableCrtPreloadChecks);
    if (disableChecksToggle) {
      disableChecksToggle.checked = disableCrtPreloadChecks;
      disableChecksToggle.addEventListener('change', () => {
        const disabled = disableChecksToggle.checked;
        window.localStorage.setItem(CRT_PRELOAD_CHECKS_STORAGE_KEY, disabled ? '1' : '0');
        this.player?.setCrtPreloadChecksDisabled(disabled);
      });
    }
    if (saveSnapshotBtn) {
      saveSnapshotBtn.addEventListener('click', () => {
        if (!this.player || typeof this.player.getSnapshot !== 'function') return;
        const statusEl = document.getElementById('status');
        try {
          this.downloadSnapshot(this.player.getSnapshot());
          if (statusEl) {
            statusEl.textContent = 'Snapshot saved';
          }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = `Snapshot save failed: ${String((err as Error)?.message ?? err)}`;
          }
        }
      });
    }
    if (detachBtn) {
      detachBtn.addEventListener('click', () => {
        if (!this.player) return;
        if (!confirm('Detach cartridge?')) return;
        this.player.detachCartridge();
        // Provide immediate UI feedback
        const statusEl = document.getElementById('status');
        if (statusEl) {
          statusEl.textContent = 'Cartridge detached';
        }
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!this.player) return;
        if (!confirm('Perform hard reset? This will restart the emulator.')) return;
        this.player.hardReset();
        const statusEl = document.getElementById('status');
        if (statusEl) {
          statusEl.textContent = 'Hard reset performed';
        }
      });
    }
    if (rebootBtn) {
      rebootBtn.addEventListener('click', async () => {
        if (!this.player) return;
        if (!confirm('Perform full reboot? This re-instantiates the emulator with no game loaded.'))
          return;
        const statusEl = document.getElementById('status');
        if (statusEl) {
          statusEl.textContent = 'Rebooting emulator...';
        }
        try {
          await this.player.reboot();
          if (statusEl) {
            statusEl.textContent = 'Emulator rebooted (no game loaded)';
          }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = `Reboot failed: ${String((err as Error)?.message ?? err)}`;
          }
        }
      });
    }

    // ── Audio section ─────────────────────────────────────────────────────
    const audioContainer = panel.querySelector('#c64-audio-section-anchor') as HTMLElement;
    this.createAudioSection(audioContainer);

    // ── Input section wiring ───────────────────────────────────────────────
    const joyRadios = panel.querySelectorAll(
      'input[name="c64-joy-port"]',
    ) as NodeListOf<HTMLInputElement>;
    const setJoyPort = (port: JoystickPort) => {
      // Dispatch a global event so main app or player can pick it up
      window.dispatchEvent(new CustomEvent('c64-set-keyboard-joy-port', { detail: { port } }));
      // If a player instance exists, try to set the input handler directly via the public API
      if (this.player && typeof this.player.setKeyboardJoystickPort === 'function') {
        try {
          this.player.setKeyboardJoystickPort(port);
        } catch {
          // ignore errors from consumer implementations
        }
      }
    };
    joyRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) setJoyPort(Number(r.value) as JoystickPort);
      });
    });

    // ── Input mode wiring ──────────────────────────────────────────────────
    const inputModeHints: Record<string, string> = {
      joystick: 'Arrows + Ctrl = joystick only',
      keyboard: 'All keys &rarr; C64 keyboard matrix',
      mixed: 'Arrows + Z + Ctrl = joystick &amp; all other keys &rarr; C64 keyboard',
    };
    const inputModeRadios = panel.querySelectorAll(
      'input[name="c64-input-mode"]',
    ) as NodeListOf<HTMLInputElement>;
    const hintEl = panel.querySelector('#c64-input-mode-hint') as HTMLElement | null;
    const applyInputMode = (mode: string) => {
      if (hintEl) hintEl.innerHTML = inputModeHints[mode] ?? '';
      window.dispatchEvent(new CustomEvent('c64-set-input-mode', { detail: { mode } }));
      if (this.player && typeof this.player.setInputMode === 'function') {
        try {
          this.player.setInputMode(mode as import('../emulator/input').InputMode);
        } catch {
          // ignore
        }
      }
    };
    inputModeRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) applyInputMode(r.value);
      });
    });
    this.renderGamepadButtons();

    // ── Display section wiring ─────────────────────────────────────────────
    const displayRadios = panel.querySelectorAll(
      'input[name="c64-display-mode"]',
    ) as NodeListOf<HTMLInputElement>;
    const canvas = document.getElementById('c64-screen') as HTMLCanvasElement | null;
    const applyDisplayMode = (mode: string) => {
      if (!canvas) return;
      // Reset to defaults first
      canvas.style.width = '';
      canvas.style.height = '';
      canvas.style.objectFit = '';
      canvas.removeAttribute('data-display-mode');

      if (mode === 'standard') {
        // Use the default CSS size (no change)
        canvas.style.width = '';
        canvas.style.height = '';
        // Restore the default border from CSS
        canvas.style.border = '';
        // Restore any previously-saved page overflow styles so scrollbars reappear
        if (this.savedHtmlOverflow !== null) {
          document.documentElement.style.overflow = this.savedHtmlOverflow;
          this.savedHtmlOverflow = null;
        } else {
          document.documentElement.style.overflow = '';
        }
        if (this.savedBodyOverflow !== null) {
          document.body.style.overflow = this.savedBodyOverflow;
          this.savedBodyOverflow = null;
        } else {
          document.body.style.overflow = '';
        }
      } else if (mode === 'full') {
        // Maintain aspect ratio, make canvas fill the full height of the browser
        canvas.style.height = '100vh';
        canvas.style.width = 'auto';
        canvas.style.objectFit = 'contain';
        // Remove canvas border in full-screen-like modes
        canvas.style.border = 'none';
        // Hide page scrollbars (prevent overflow when canvas touches edges)
        if (this.savedHtmlOverflow === null)
          this.savedHtmlOverflow = document.documentElement.style.overflow;
        if (this.savedBodyOverflow === null) this.savedBodyOverflow = document.body.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      } else if (mode === 'stretch') {
        // Stretch to full width and height (may alter aspect ratio)
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
        canvas.style.objectFit = 'fill';
        // Remove canvas border in full-screen-like modes
        canvas.style.border = 'none';
        // Hide page scrollbars (prevent overflow when canvas touches edges)
        if (this.savedHtmlOverflow === null)
          this.savedHtmlOverflow = document.documentElement.style.overflow;
        if (this.savedBodyOverflow === null) this.savedBodyOverflow = document.body.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      }
      canvas.setAttribute('data-display-mode', mode);
      window.dispatchEvent(new CustomEvent('c64-display-mode-changed', { detail: { mode } }));
    };

    displayRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) applyDisplayMode(r.value);
      });
    });

    window.addEventListener('c64-close-dialog', () => {
      this.closeMenu();
    });

    // Close settings when a load completes or errors so the user sees the result
    // window.addEventListener('c64-load-success', () => {
    //   this.settingsOverlay?.classList.remove('visible');
    // });
    window.addEventListener('c64-load-error', () => {
      this.settingsOverlay?.classList.remove('visible');
    });
  }

  /** Floating unmute button — shown when autoplay is blocked by the browser */
  private createUnmuteButton(): void {
    const btn = document.createElement('button');
    btn.className = 'c64-unmute-btn hidden';
    btn.innerHTML = '&#128263;'; // 🔇 muted icon — audio is OFF when this button shows
    btn.title = 'Click to enable audio';
    btn.addEventListener('click', async () => {
      if (this.player) {
        await this.player.audio.resume();
        if (!this.player.audio.suspended) {
          btn.classList.add('hidden');
        }
      }
    });
    document.body.appendChild(btn);

    // Show the button when audio is suspended (autoplay blocked)
    window.addEventListener('c64-audio-suspended', () => {
      btn.classList.remove('hidden');
    });

    // Listen for audio state changes dispatched by C64Player
    window.addEventListener('c64-audio-state', ((e: CustomEvent) => {
      const state = e.detail as { muted: boolean; volume: number; suspended: boolean };
      if (!state.suspended) {
        btn.classList.add('hidden');
      }
      // Sync the menu controls
      this.syncAudioControls(state);
    }) as EventListener);
  }

  /** Audio controls inside the settings menu (mute toggle + volume slider) */
  private createAudioSection(container: HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'c64-audio-section';
    section.innerHTML = `
      <label>Audio</label>
      <div class="c64-audio-row">
        <button class="c64-mute-btn" id="c64-mute-btn" title="Toggle mute">&#128264;</button>
        <input type="range" class="c64-volume-slider" id="c64-volume-slider" min="0" max="100" value="75" />
        <span class="c64-volume-label" id="c64-volume-label">75%</span>
      </div>
    `;
    container.appendChild(section);

    const muteBtn = section.querySelector('#c64-mute-btn') as HTMLButtonElement;
    const slider = section.querySelector('#c64-volume-slider') as HTMLInputElement;
    const label = section.querySelector('#c64-volume-label') as HTMLElement;

    muteBtn.addEventListener('click', () => {
      if (!this.player) return;
      this.player.audio.toggleMute();
      // If audio was suspended, also resume on this gesture
      if (this.player.audio.suspended) {
        this.player.audio.resume();
      }
    });

    slider.addEventListener('input', () => {
      if (!this.player) return;
      const v = Number(slider.value) / 100;
      this.player.audio.setVolume(v);
      label.textContent = `${slider.value}%`;
      // If audio was suspended, also resume on this gesture
      if (this.player.audio.suspended) {
        this.player.audio.resume();
      }
    });
  }

  /** Sync menu audio controls with current audio state */
  private syncAudioControls(state: { muted: boolean; volume: number; suspended: boolean }): void {
    const muteBtn = document.getElementById('c64-mute-btn');
    const slider = document.getElementById('c64-volume-slider') as HTMLInputElement | null;
    const label = document.getElementById('c64-volume-label');

    if (muteBtn) {
      muteBtn.innerHTML = state.muted ? '&#128263;' : '&#128264;'; // 🔇 vs 🔈
      muteBtn.classList.toggle('muted', state.muted);
    }
    if (slider) {
      slider.value = String(Math.round(state.volume * 100));
    }
    if (label) {
      label.textContent = `${Math.round(state.volume * 100)}%`;
    }
  }

  private toggleMenu(): void {
    this.settingsOverlay?.classList.toggle('visible');
  }

  private closeMenu(): void {
    this.settingsOverlay?.classList.remove('visible');
  }

  open(): void {
    this.helpOverlay?.classList.add('visible');
  }

  close(): void {
    this.helpOverlay?.classList.remove('visible');
  }
}
