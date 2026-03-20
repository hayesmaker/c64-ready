import { beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasRenderer from './canvas-renderer';

describe('CanvasRenderer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('throws when canvas is missing', () => {
    expect(() => new CanvasRenderer('missing')).toThrow('Canvas not found: missing');
  });

  it('renders a frame using 2d context', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'c64-screen';
    document.body.appendChild(canvas);

    const putImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({ putImageData } as unknown as CanvasRenderingContext2D);

    const renderer = new CanvasRenderer('c64-screen');
    renderer.render({
      width: 4,
      height: 2,
      data: new Uint8Array(4 * 2 * 4),
      timestamp: 1,
    });

    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(2);
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it('attaches to emulator frame updates and ticks on animation frames', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'c64-screen';
    document.body.appendChild(canvas);

    const putImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({ putImageData } as unknown as CanvasRenderingContext2D);

    const raf = { callback: null as ((time: number) => void) | null, id: 0 };
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (time: number) => void) => {
      raf.callback = cb;
      raf.id += 1;
      return raf.id;
    }));
    const cancelSpy = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);

    const renderer = new CanvasRenderer('c64-screen');
    const emulator = { onFrame: undefined, tick: vi.fn() } as any;

    renderer.attachTo(emulator, 10);
    expect(typeof emulator.onFrame).toBe('function');

    raf.callback?.(0);
    expect(emulator.tick).toHaveBeenCalledWith(10);

    emulator.onFrame({
      width: 2,
      height: 2,
      data: new Uint8Array(16),
      timestamp: 1,
    });
    expect(putImageData).toHaveBeenCalledOnce();

    renderer.attachTo(emulator, 10);
    expect(cancelSpy).toHaveBeenCalledWith(2);
  });
});

