// Extracted CSS is loaded from a separate stylesheet to keep JS focused on behavior.
import css from './styles/ui-controller.css?raw';

const CONTROLS = [
  ['Move Up', '↑'],
  ['Move Down', '↓'],
  ['Move Left', '←'],
  ['Move Right', '→'],
  ['Fire', 'Left Ctrl'],
];

import type { C64Player } from './c64-player';
import type { JoystickPort } from '../emulator/constants';
import {
  LOAD_FORMAT_OPTIONS,
  getAcceptForLoadTypeSelection,
  getLoadTypeLabel,
  resolveLoadTypeSelection,
  type LoadTypeSelection,
} from './load-formats';

export default class UIController {
  private helpOverlay: HTMLElement | null = null;
  private settingsOverlay: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private player: C64Player | null = null;
  // Save previous overflow styles so we can restore them when exiting full/stretch
  private savedHtmlOverflow: string | null = null;
  private savedBodyOverflow: string | null = null;

  init(player?: C64Player): void {
    this.player = player ?? null;
    this.injectCSS();
    this.createButton();
    this.createDialog();
    this.createHamburger();
    this.createMenu();
    this.createUnmuteButton();
  }

  private injectCSS(): void {
    if (document.querySelector('style[data-c64-help]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-c64-help', '');
    style.textContent = css;
    document.head.appendChild(style);
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

    overlay.innerHTML = `
      <div class="c64-help-dialog">
        <button class="c64-help-close">&times;</button>
        <h2>C64 READY</h2>
        <p>A Commodore 64 emulator running in the browser via WebAssembly.</p>
        <p><a href="https://github.com/hayesmaker/c64-ready" target="_blank" rel="noopener">Source code on GitHub</a> · <a href="#" id="c64-view-changelog">View changelog</a></p>
        <h2>CONTROLS</h2>
        <ul class="c64-help-controls">${controlItems}</ul>
        <div class="c64-version">${
          'v' +
          (import.meta.env.VITE_APP_VERSION ?? '0.0.0') +
          (import.meta.env.VITE_GIT_HASH ? ` (build: ${import.meta.env.VITE_GIT_HASH})` : '')
        }</div>
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
      const md = await import('../../CHANGELOG.md?raw');
      const raw: string = md.default ?? md;

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
          </section>

          <section class="c64-settings-section" data-settings-section="input" hidden>
            <label class="c64-section-label">Input Port</label>
            <div class="c64-radio-row">
              <label><input type="radio" name="c64-joy-port" value="1" /> Port 1</label>
              <label><input type="radio" name="c64-joy-port" value="2" checked /> Port 2</label>
            </div>
            <label class="c64-section-label">Input Mode</label>
            <div class="c64-radio-row c64-radio-row-wrap">
              <label><input type="radio" name="c64-input-mode" value="joystick" checked /> Joystick</label>
              <label><input type="radio" name="c64-input-mode" value="keyboard" /> Keyboard</label>
              <label><input type="radio" name="c64-input-mode" value="mixed" /> Mixed</label>
            </div>
            <div id="c64-input-mode-hint" class="c64-section-hint">Arrows + Ctrl = joystick</div>
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

          <section class="c64-settings-section" data-settings-section="system" hidden>
            <label class="c64-section-label">System Actions</label>
            <div class="c64-system-actions">
              <button class="c64-btn" id="c64-detach-btn">Detach Cartridge</button>
              <button class="c64-btn" id="c64-reset-btn">Hard Reset</button>
            </div>
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

    const tabButtons = panel.querySelectorAll('[data-settings-tab]') as NodeListOf<HTMLButtonElement>;
    const sectionEls = panel.querySelectorAll(
      '[data-settings-section]'
    ) as NodeListOf<HTMLElement>;

    const activateSection = (sectionId: string) => {
      tabButtons.forEach((tab) => {
        const active = tab.dataset.settingsTab === sectionId;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      sectionEls.forEach((section) => {
        section.hidden = section.dataset.settingsSection !== sectionId;
      });
    };

    tabButtons.forEach((tab) => {
      tab.addEventListener('click', () => {
        const sectionId = tab.dataset.settingsTab;
        if (sectionId) activateSection(sectionId);
      });
    });

    // wire up file input and drag/drop
    this.fileInput = panel.querySelector('#c64-file-input') as HTMLInputElement;
    const dragarea = panel.querySelector('#c64-dragarea') as HTMLElement;
    const dragareaCopy = panel.querySelector('#c64-dragarea-copy') as HTMLElement;
    const browse = panel.querySelector('#c64-browse') as HTMLButtonElement;
    const loadTypeSelect = panel.querySelector('#c64-load-format') as HTMLSelectElement;
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

    const section = panel.querySelector('[data-settings-section="system"]');
    // Detach cartridge / hard reset controls
    const detachBtn = section?.querySelector('#c64-detach-btn') as HTMLButtonElement | null;
    const resetBtn = section?.querySelector('#c64-reset-btn') as HTMLButtonElement | null;
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
