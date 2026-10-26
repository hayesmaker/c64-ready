import type { C64Player } from './c64-player';
import { inferLoadTypeFromFilename } from './load-formats';
import {
  DEFAULT_BRIDGE_URL,
  ULTIMATE_BRIDGE_PACKAGE_URL,
  getSavedUltimateSettings,
  getUltimateInfo,
  isUltimateFileType,
  isValidUltimateIp,
  launchOnUltimate,
  powerOffUltimate,
  rebootUltimate,
  saveUltimateSettings,
  type UltimateDeviceInfo,
  type UltimateFileType,
  type UltimateSettings,
} from './ultimate-bridge';

type StatusMode = 'info' | 'ok' | 'error';

/**
 * Settings section for playing games on a real Ultimate 64 / C64 Ultimate / Ultimate II+
 * through the C64Cade Ultimate Bridge npm package running on the user's machine.
 */
export default class UltimatePanel {
  private deviceInfo: UltimateDeviceInfo | null = null;
  private busy = false;
  private els!: {
    bridgeUrl: HTMLInputElement;
    ip: HTMLInputElement;
    password: HTMLInputElement;
    connectBtn: HTMLButtonElement;
    device: HTMLElement;
    currentGame: HTMLElement;
    sendCurrentBtn: HTMLButtonElement;
    sendFileBtn: HTMLButtonElement;
    fileInput: HTMLInputElement;
    rebootBtn: HTMLButtonElement;
    powerOffBtn: HTMLButtonElement;
    status: HTMLElement;
  };

  private readonly container: HTMLElement;
  private readonly getPlayer: () => C64Player | null;

  constructor(container: HTMLElement, getPlayer: () => C64Player | null) {
    this.container = container;
    this.getPlayer = getPlayer;
  }

  init(): void {
    this.render();
    this.bind();
    this.updateCurrentGame();
    this.updateControls();
    if (isValidUltimateIp(this.settings().ip)) void this.connect({ silent: true });
  }

  private render(): void {
    const saved = getSavedUltimateSettings();

    this.container.innerHTML = `
      <label class="c64-section-label">Ultimate Player</label>
      <div class="c64-section-hint">
        Play games on a real Ultimate 64, C64 Ultimate or Ultimate II+. Run the
        <a href="${ULTIMATE_BRIDGE_PACKAGE_URL}" target="_blank" rel="noopener noreferrer">C64Cade Ultimate Bridge</a>
        on this computer first: <code>npx @c64cade/ultimate-bridge</code>
      </div>
      <div class="c64-form-row">
        <label for="c64-ultimate-bridge-url">Bridge URL</label>
        <input id="c64-ultimate-bridge-url" class="c64-text-input" type="url" placeholder="${DEFAULT_BRIDGE_URL}" />
      </div>
      <div class="c64-form-row">
        <label for="c64-ultimate-ip">Ultimate IP</label>
        <input id="c64-ultimate-ip" class="c64-text-input" type="text" inputmode="decimal" placeholder="192.168.0.10" />
      </div>
      <div class="c64-form-row">
        <label for="c64-ultimate-password">Password</label>
        <input id="c64-ultimate-password" class="c64-text-input" type="password" autocomplete="off" placeholder="(optional)" />
      </div>
      <div class="c64-menu-actions">
        <button class="c64-btn" id="c64-ultimate-connect" type="button">Connect</button>
        <span class="c64-inline-status" id="c64-ultimate-device">Not connected</span>
      </div>

      <div class="c64-tools-section">
        <label class="c64-section-label">Launch on Ultimate</label>
        <div class="c64-form-row">
          <button class="c64-btn" id="c64-ultimate-send-current" type="button">Send Current Game</button>
          <span class="c64-inline-status" id="c64-ultimate-current-game"></span>
        </div>
        <div class="c64-form-row">
          <button class="c64-btn" id="c64-ultimate-send-file" type="button">Send File…</button>
          <span class="c64-inline-status">.prg, .crt or .d64</span>
          <input id="c64-ultimate-file" class="c64-file-input" type="file" accept=".prg,.crt,.d64" />
        </div>
      </div>

      <div class="c64-tools-section">
        <label class="c64-section-label">Device</label>
        <div class="c64-system-actions">
          <button class="c64-btn" id="c64-ultimate-reboot" type="button">Reboot Ultimate</button>
          <button class="c64-btn" id="c64-ultimate-poweroff" type="button">Power Off</button>
        </div>
      </div>
      <div class="c64-cheat-status" id="c64-ultimate-status" role="status"></div>
    `;

    const q = <T extends Element>(sel: string) => this.container.querySelector(sel) as T;
    this.els = {
      bridgeUrl: q('#c64-ultimate-bridge-url'),
      ip: q('#c64-ultimate-ip'),
      password: q('#c64-ultimate-password'),
      connectBtn: q('#c64-ultimate-connect'),
      device: q('#c64-ultimate-device'),
      currentGame: q('#c64-ultimate-current-game'),
      sendCurrentBtn: q('#c64-ultimate-send-current'),
      sendFileBtn: q('#c64-ultimate-send-file'),
      fileInput: q('#c64-ultimate-file'),
      rebootBtn: q('#c64-ultimate-reboot'),
      powerOffBtn: q('#c64-ultimate-poweroff'),
      status: q('#c64-ultimate-status'),
    };

    this.els.bridgeUrl.value = saved.bridgeUrl === DEFAULT_BRIDGE_URL ? '' : saved.bridgeUrl;
    this.els.ip.value = saved.ip;
    this.els.password.value = saved.password;
  }

  private bind(): void {
    [this.els.bridgeUrl, this.els.ip, this.els.password].forEach((input) => {
      // Save as the user types so a reload or closed tab never loses the IP
      input.addEventListener('input', () => this.saveFields());
      input.addEventListener('change', () => {
        this.saveFields();
        this.deviceInfo = null;
        this.updateControls();
      });
    });

    this.els.connectBtn.addEventListener('click', () => void this.connect());
    this.els.sendCurrentBtn.addEventListener('click', () => void this.sendCurrentGame());
    this.els.sendFileBtn.addEventListener('click', () => this.els.fileInput.click());
    this.els.fileInput.addEventListener('change', () => {
      const file = this.els.fileInput.files?.[0];
      this.els.fileInput.value = '';
      if (file) void this.sendFile(file);
    });
    this.els.rebootBtn.addEventListener('click', () => void this.reboot());
    this.els.powerOffBtn.addEventListener('click', () => void this.powerOff());

    const onGameChanged = () => {
      this.updateCurrentGame();
      this.updateControls();
    };
    window.addEventListener('c64-load-success', onGameChanged);
    window.addEventListener('c64-detach', onGameChanged);
    window.addEventListener('c64-reboot', onGameChanged);
  }

  private settings(): UltimateSettings {
    return {
      bridgeUrl: this.els.bridgeUrl.value.trim() || DEFAULT_BRIDGE_URL,
      ip: this.els.ip.value.trim(),
      password: this.els.password.value,
    };
  }

  private saveFields(): void {
    saveUltimateSettings({
      bridgeUrl: this.els.bridgeUrl.value.trim(),
      ip: this.els.ip.value.trim(),
      password: this.els.password.value,
    });
  }

  private async connect({ silent = false } = {}): Promise<void> {
    await this.run(
      silent ? '' : 'Connecting to Ultimate…',
      async () => {
        this.saveFields();
        const settings = this.settings();
        if (!isValidUltimateIp(settings.ip)) {
          throw new Error("Enter your Ultimate's IPv4 address, e.g. 192.168.0.10.");
        }
        this.deviceInfo = null;
        this.deviceInfo = await getUltimateInfo(settings);
        return silent ? '' : `Connected to ${this.describeDevice()}`;
      },
      { silentErrors: silent },
    );
  }

  private async sendCurrentGame(): Promise<void> {
    const game = this.currentGame();
    if (!game) return;
    if (!isUltimateFileType(game.type)) {
      this.setStatus(
        `Ultimate can't launch ${game.type} files — only .prg, .crt and .d64.`,
        'error',
      );
      return;
    }
    await this.launch(game.name, game.type, game.data);
  }

  private async sendFile(file: File): Promise<void> {
    const type = inferLoadTypeFromFilename(file.name);
    if (!isUltimateFileType(type)) {
      this.setStatus(`${file.name} isn't a .prg, .crt or .d64 file.`, 'error');
      return;
    }
    await this.launch(file.name, type, new Uint8Array(await file.arrayBuffer()));
  }

  private async launch(
    filename: string,
    fileType: UltimateFileType,
    data: Uint8Array<ArrayBufferLike>,
  ): Promise<void> {
    await this.run(`Sending ${filename} to Ultimate…`, async () => {
      await launchOnUltimate(this.settings(), { filename, fileType, data });
      return `Launched ${filename} on ${this.describeDevice()}`;
    });
  }

  private async reboot(): Promise<void> {
    if (!confirm('Reboot the Ultimate? Anything running on it will be lost.')) return;
    await this.run('Rebooting Ultimate…', async () => {
      await rebootUltimate(this.settings());
      return 'Ultimate rebooted';
    });
  }

  private async powerOff(): Promise<void> {
    if (!confirm('Power off the Ultimate? You will need to switch it back on by hand.')) return;
    await this.run('Powering off Ultimate…', async () => {
      await powerOffUltimate(this.settings());
      this.deviceInfo = null;
      return 'Ultimate powered off';
    });
  }

  /** Runs a bridge request with the buttons disabled, reporting progress and errors. */
  private async run(
    pending: string,
    task: () => Promise<string>,
    { silentErrors = false } = {},
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (pending) this.setStatus(pending);
    this.updateControls();
    try {
      const done = await task();
      if (done) this.setStatus(done, 'ok');
      else if (pending) this.setStatus('');
    } catch (err) {
      if (silentErrors) this.setStatus('');
      else this.setStatus(errorText(err), 'error');
    } finally {
      this.busy = false;
      this.updateControls();
    }
  }

  private describeDevice(): string {
    const product = this.deviceInfo?.product || 'Ultimate';
    const ip = this.settings().ip;
    return ip ? `${product} at ${ip}` : product;
  }

  private currentGame() {
    return this.getPlayer()?.getCurrentGame?.() ?? null;
  }

  private updateCurrentGame(): void {
    const game = this.currentGame();
    this.els.currentGame.textContent = game ? game.name : 'No game loaded';
  }

  private updateControls(): void {
    if (this.deviceInfo) {
      const info = this.deviceInfo;
      const versions = [
        info.firmware_version && `firmware ${info.firmware_version}`,
        info.fpga_version && `FPGA ${info.fpga_version}`,
      ].filter(Boolean);
      this.els.device.textContent = `● ${this.describeDevice()}${versions.length ? ` (${versions.join(', ')})` : ''}`;
      this.els.device.dataset.connected = 'true';
    } else {
      this.els.device.textContent = 'Not connected';
      delete this.els.device.dataset.connected;
    }

    const connected = !!this.deviceInfo;
    const game = this.currentGame();
    this.els.connectBtn.disabled = this.busy;
    this.els.connectBtn.textContent = connected ? 'Reconnect' : 'Connect';
    this.els.sendCurrentBtn.disabled = this.busy || !connected || !game;
    this.els.sendFileBtn.disabled = this.busy || !connected;
    this.els.rebootBtn.disabled = this.busy || !connected;
    this.els.powerOffBtn.disabled = this.busy || !connected;
  }

  private setStatus(message: string, mode: StatusMode = 'info'): void {
    this.els.status.textContent = message;
    this.els.status.hidden = !message;
    this.els.status.dataset.mode = mode;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
