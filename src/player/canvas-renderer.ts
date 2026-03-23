import type { FrameBuffer } from '../types';
import type { C64Emulator } from '../emulator/c64-emulator';

import loaderCss from './styles/canvas-renderer.css?raw';

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
      style.textContent = loaderCss;
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

  showLoader(): void {
    this.ensureLoader();
    if (!this.loaderEl) return;
    // Ensure it's visible (remove hidden class) and reset styles
    this.loaderEl.classList.remove('hidden');
    if (this.loaderFill) {
      this.loaderFill.style.width = '0';
      this.loaderFill.style.background = '';
    }
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
