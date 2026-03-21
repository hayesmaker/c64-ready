import type { FrameBuffer } from '../types';
import type { C64Emulator } from '../emulator/c64-emulator';

const LOADER_CSS = `
  .c64-loader {
    position: relative;
    width: 768px;
    margin-top: 12px;
    transition: opacity 0.6s ease, transform 0.6s ease;
  }
  .c64-loader.hidden {
    opacity: 0;
    transform: translateY(-6px);
    pointer-events: none;
  }
  .c64-loader-label {
    font-family: monospace;
    font-size: 12px;
    color: #7b71d5;
    margin-bottom: 4px;
    letter-spacing: 1px;
  }
  .c64-loader-track {
    width: 100%;
    height: 10px;
    background: #222;
    border: 1px solid #444;
    border-radius: 2px;
    overflow: hidden;
  }
  .c64-loader-fill {
    height: 100%;
    width: 0;
    background: linear-gradient(90deg, #6c6cff 0%, #a8a8ff 50%, #6c6cff 100%);
    background-size: 200% 100%;
    border-radius: 2px;
    transition: width 0.5s cubic-bezier(.22,.61,.36,1);
    animation: c64-shimmer 1.5s linear infinite;
  }
  @keyframes c64-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

export default class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;

  // Loader elements (created lazily)
  private loaderEl: HTMLElement | null = null;
  private loaderLabel: HTMLElement | null = null;
  private loaderFill: HTMLElement | null = null;

  constructor(canvasOrId: string | HTMLCanvasElement) {
    const canvas =
      typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`Canvas not found: ${String(canvasOrId)}`);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context not available');
    }

    this.canvas = canvas;
    this.ctx = ctx;
  }

  // ── Loading progress bar ──────────────────────────────────────────────────

  private ensureLoader(): void {
    if (this.loaderEl) return;

    if (!document.querySelector('style[data-c64-loader]')) {
      const style = document.createElement('style');
      style.setAttribute('data-c64-loader', '');
      style.textContent = LOADER_CSS;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.className = 'c64-loader';

    const label = document.createElement('div');
    label.className = 'c64-loader-label';
    label.textContent = 'LOADING...';

    const track = document.createElement('div');
    track.className = 'c64-loader-track';

    const fill = document.createElement('div');
    fill.className = 'c64-loader-fill';

    track.appendChild(fill);
    overlay.appendChild(label);
    overlay.appendChild(track);

    this.canvas.insertAdjacentElement('afterend', overlay);

    this.loaderEl = overlay;
    this.loaderLabel = label;
    this.loaderFill = fill;
  }

  setProgress(percent: number, label: string): void {
    this.ensureLoader();
    this.loaderFill!.style.width = `${Math.min(percent, 100)}%`;
    this.loaderLabel!.textContent = label;
  }

  setError(message: string): void {
    this.ensureLoader();
    this.loaderFill!.style.width = '0';
    this.loaderFill!.style.background = '#f44';
    this.loaderLabel!.textContent = message;
  }

  hideLoader(delayMs: number = 600): void {
    if (!this.loaderEl) return;
    const el = this.loaderEl;
    setTimeout(() => {
      el.classList.add('hidden');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, delayMs);
    this.loaderEl = null;
    this.loaderLabel = null;
    this.loaderFill = null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  render(frame: FrameBuffer): void {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }

    const imageData = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);

    this.ctx.putImageData(imageData, 0, 0);
  }

  attachTo(emulator: C64Emulator): void {
    emulator.onFrame = (frame) => {
      this.render(frame);
    };

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    let lastTimestamp = 0;

    const runFrame = (timestamp: number) => {
      const dTime = lastTimestamp ? timestamp - lastTimestamp : 0;
      lastTimestamp = timestamp;

      emulator.tick(dTime);
      this.animationFrameId = requestAnimationFrame(runFrame);
    };

    this.animationFrameId = requestAnimationFrame(runFrame);
  }
}
