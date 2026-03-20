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

const CONTROLS = [
  ['Move Up', '↑'],
  ['Move Down', '↓'],
  ['Move Left', '←'],
  ['Move Right', '→'],
  ['Fire', 'Left Ctrl'],
];

export default class UIController {
  private overlay: HTMLElement | null = null;

  init(): void {
    this.injectCSS();
    this.createButton();
    this.createDialog();
  }

  private injectCSS(): void {
    if (document.querySelector('style[data-c64-help]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-c64-help', '');
    style.textContent = HELP_CSS;
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

    const controlItems = CONTROLS
      .map(([action, key]) =>
        `<li><span>${action}</span><span class="c64-help-key">${key}</span></li>`)
      .join('');

    overlay.innerHTML = `
      <div class="c64-help-dialog">
        <button class="c64-help-close">&times;</button>
        <h2>C64 READY</h2>
        <p>A Commodore 64 emulator running in the browser via WebAssembly.</p>
        <p><a href="https://github.com/hayesmaker/c64-ready" target="_blank" rel="noopener">Source code on GitHub</a></p>
        <h2>CONTROLS</h2>
        <ul class="c64-help-controls">${controlItems}</ul>
      </div>
    `;

    overlay.querySelector('.c64-help-close')!
      .addEventListener('click', () => this.close());

    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  open(): void {
    this.overlay?.classList.add('visible');
  }

  close(): void {
    this.overlay?.classList.remove('visible');
  }
}

