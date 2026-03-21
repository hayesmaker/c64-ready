const HELP_CSS = `
  .c64-help-btn {
    position: fixed;
    top: 12px;
    right: 12px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid #555;
    background: #222;
    color: #7b71d5;
    font-family: monospace;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s, color 0.2s;
    z-index: 1000;
  }
  .c64-help-btn:hover {
    border-color: #7b71d5;
    color: #a8a8ff;
  }

  .c64-help-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1001;
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
  }
  .c64-help-overlay.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .c64-help-dialog {
    background: #1a1a2e;
    border: 2px solid #555;
    border-radius: 6px;
    padding: 24px 32px;
    max-width: 420px;
    width: 90%;
    font-family: monospace;
    color: #ccc;
    position: relative;
  }
  .c64-help-dialog h2 {
    margin: 0 0 8px;
    font-size: 16px;
    color: #7b71d5;
    letter-spacing: 1px;
  }
  .c64-version {
    display: flex;
    justify-content: end;
    font-size: 12px;
    color: #999;
    margin-top: 36px;
  }
  .c64-changelog-dialog {
    max-width: 760px;
    max-height: 70vh;
    overflow: auto;
  }
  .c64-help-dialog p {
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.5;
    color: #aaa;
  }
  .c64-help-dialog a {
    color: #a8a8ff;
    text-decoration: none;
  }
  .c64-help-dialog a:hover {
    text-decoration: underline;
  }
  .c64-help-controls {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
  }
  .c64-help-controls li {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px solid #2a2a3e;
  }
  .c64-help-controls li:last-child {
    border-bottom: none;
  }
  .c64-help-key {
    background: #2a2a3e;
    border: 1px solid #444;
    border-radius: 3px;
    padding: 1px 8px;
    font-size: 12px;
    color: #ddd;
  }
  .c64-help-close {
    position: absolute;
    top: 10px;
    right: 14px;
    background: none;
    border: none;
    color: #666;
    font-size: 20px;
    cursor: pointer;
    font-family: monospace;
  }
  .c64-help-close:hover {
    color: #f44;
  }
`;

const UI_CSS = `
  .c64-hamburger {
    position: fixed;
    top: 12px;
    left: 12px;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    border: 2px solid #444;
    background: #111;
    color: #ddd;
    font-family: monospace;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .c64-menu-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 48px 24px;
    z-index: 1002;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .c64-menu-overlay.visible { opacity: 1; pointer-events: auto; }
  .c64-menu-panel {
    background: #0f0f1a;
    border: 2px solid #333;
    border-radius: 8px;
    padding: 16px;
    min-width: 320px;
    color: #ddd;
    font-family: monospace;
  }
  .c64-menu-header { display:flex; align-items:center; justify-content:space-between; }
  .c64-menu-close { background:none; border:none; color:#888; font-size:20px; cursor:pointer; }
  .c64-dragarea {
    border: 2px dashed #2a2a3e;
    border-radius: 6px;
    padding: 12px;
    margin-top: 12px;
    text-align: center;
    color: #aaa;
    background: linear-gradient(180deg, rgba(255,255,255,0.01), transparent);
  }
  .c64-dragarea.dragover { border-color: #7b71d5; color: #fff; }
  .c64-cart-preview { display:flex; gap:12px; align-items:center; margin-top:12px; }
  .c64-cart-icon { width:56px; height:40px; background:#222; border:1px solid #333; display:flex; align-items:center; justify-content:center; border-radius:4px; }
  .c64-cart-filename { font-size:13px; color:#ccc; word-break:break-all; }
  .c64-file-input { display:none; }
  .c64-menu-actions { margin-top:12px; display:flex; gap:8px; }
  .c64-btn { background:#222; border:1px solid #444; color:#ddd; padding:6px 10px; border-radius:4px; cursor:pointer; }
`;

const CONTROLS = [
  ['Move Up', '↑'],
  ['Move Down', '↓'],
  ['Move Left', '←'],
  ['Move Right', '→'],
  ['Fire', 'Left Ctrl'],
];

export default class UIController {
  private overlay: HTMLElement | null = null;
  private menuOverlay: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;

  init(): void {
    this.injectCSS();
    this.createButton();
    this.createDialog();
    this.createHamburger();
    this.createMenu();
  }

  private injectCSS(): void {
    if (document.querySelector('style[data-c64-help]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-c64-help', '');
    style.textContent = HELP_CSS + '\n' + UI_CSS;
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
          'v' + (import.meta.env.VITE_APP_VERSION ?? '0.0.0') +
          (import.meta.env.VITE_GIT_HASH ? ` (build: ${import.meta.env.VITE_GIT_HASH})` : '')
        }</div>
      </div>
    `;

    overlay.querySelector('.c64-help-close')!.addEventListener('click', () => this.close());

    document.body.appendChild(overlay);
    this.overlay = overlay;
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
    changelogOverlay.querySelector('.c64-help-close')!.addEventListener('click', () => changelogOverlay.classList.remove('visible'));
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
      // @ts-ignore
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
    } catch (e) {
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
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeMenu(); });

    const panel = document.createElement('div');
    panel.className = 'c64-menu-panel';
    panel.innerHTML = `
      <div class="c64-menu-header">
        <strong>Settings</strong>
        <button class="c64-menu-close">&times;</button>
      </div>
      <div class="c64-menu-body">
        <label style="font-size:13px;color:#aaa">Load cartridge (.crt)</label>
        <div class="c64-dragarea" id="c64-dragarea">Drop a .crt file here or <button class="c64-btn" id="c64-browse">Browse</button></div>
        <input class="c64-file-input" id="c64-file-input" type="file" accept=".crt" />
        <div class="c64-cart-preview" id="c64-cart-preview" style="display:none">
          <div class="c64-cart-icon" id="c64-cart-icon" aria-hidden="true">
            <!-- simple C64 cart SVG -->
            <svg width="48" height="32" viewBox="0 0 48 32" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="44" height="24" rx="3" fill="#222" stroke="#555"/><rect x="6" y="8" width="36" height="12" fill="#2b2b3d"/></svg>
          </div>
          <div class="c64-cart-filename" id="c64-cart-filename"></div>
        </div>
        <div class="c64-menu-actions">
          <button class="c64-btn" id="c64-load-btn">Load</button>
          <button class="c64-btn" id="c64-close-menu">Close</button>
        </div>
      </div>
    `;

    panel.querySelector('.c64-menu-close')!.addEventListener('click', () => this.closeMenu());
    panel.querySelector('#c64-close-menu')!.addEventListener('click', () => this.closeMenu());

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.menuOverlay = overlay;

    // wire up file input and drag/drop
    this.fileInput = panel.querySelector('#c64-file-input') as HTMLInputElement;
    const dragarea = panel.querySelector('#c64-dragarea') as HTMLElement;
    const browse = panel.querySelector('#c64-browse') as HTMLButtonElement;
    const preview = panel.querySelector('#c64-cart-preview') as HTMLElement;
    const previewName = panel.querySelector('#c64-cart-filename') as HTMLElement;

    const handleFile = (file: File) => {
      preview.style.display = 'flex';
      previewName.textContent = file.name;
      // dispatch event for main code to pick up
      const ev = new CustomEvent('c64-load-file', { detail: { file } });
      window.dispatchEvent(ev);
    };

    dragarea.addEventListener('dragover', (e) => { e.preventDefault(); dragarea.classList.add('dragover'); });
    dragarea.addEventListener('dragleave', () => { dragarea.classList.remove('dragover'); });
    dragarea.addEventListener('drop', (e) => {
      e.preventDefault(); dragarea.classList.remove('dragover');
      const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f);
    });

    browse.addEventListener('click', () => this.fileInput?.click());
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput?.files?.[0]; if (f) handleFile(f);
    });

    panel.querySelector('#c64-load-btn')!.addEventListener('click', () => {
      // If a file is selected in preview, keep it; otherwise open file picker
      const f = this.fileInput?.files?.[0];
      if (f) handleFile(f);
      else this.fileInput?.click();
    });
  }

  private toggleMenu(): void { this.menuOverlay?.classList.toggle('visible'); }
  private closeMenu(): void { this.menuOverlay?.classList.remove('visible'); }

  open(): void {
    this.overlay?.classList.add('visible');
  }

  close(): void {
    this.overlay?.classList.remove('visible');
  }
}
