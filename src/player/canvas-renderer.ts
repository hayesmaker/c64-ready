import type {FrameBuffer} from '../types';
import type {C64Emulator} from '../emulator/c64-emulator';

export default class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;

  constructor(canvasOrId: string | HTMLCanvasElement) {
    const canvas = typeof canvasOrId === 'string'
      ? document.getElementById(canvasOrId)
      : canvasOrId;

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

  render(frame: FrameBuffer): void {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }

    const imageData = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);

    this.ctx.putImageData(imageData, 0, 0);
  }

  attachTo(emulator: C64Emulator, tickDeltaMs: number = 16): void {
    emulator.onFrame = frame => {
      this.render(frame);
    };

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const runFrame = () => {
      emulator.tick(tickDeltaMs);
      this.animationFrameId = requestAnimationFrame(runFrame);
    };

    this.animationFrameId = requestAnimationFrame(runFrame);
  }
}

