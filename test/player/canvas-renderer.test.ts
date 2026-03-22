import { beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasRenderer from '../../src/player/canvas-renderer';

describe('CanvasRenderer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.querySelectorAll('style[data-c64-loader]').forEach((el) => el.remove());
  });

  it('throws when canvas is missing', () => {
    expect(() => new CanvasRenderer('missing')).toThrow('Canvas not found: missing');
  });

  it('renders a frame using 2d context', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'c64-screen';
    document.body.appendChild(canvas);

    const putImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      putImageData,
    } as unknown as CanvasRenderingContext2D);

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

  it('attaches to emulator frame updates and ticks with rAF delta time', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'c64-screen';
    document.body.appendChild(canvas);

    const putImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      putImageData,
    } as unknown as CanvasRenderingContext2D);

    const raf = { callback: null as ((time: number) => void) | null, id: 0 };
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: (time: number) => void) => {
        raf.callback = cb;
        raf.id += 1;
        return raf.id;
      }),
    );
    const cancelSpy = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);

    const renderer = new CanvasRenderer('c64-screen');
    const emulator = { onFrame: undefined, tick: vi.fn() } as any;

    renderer.attachTo(emulator);
    expect(typeof emulator.onFrame).toBe('function');

    // First frame: no prior timestamp → dTime = 0
    raf.callback?.(1000);
    expect(emulator.tick).toHaveBeenCalledWith(0);

    // Second frame: 16ms later → real delta
    raf.callback?.(1016);
    expect(emulator.tick).toHaveBeenCalledWith(16);

    // Third frame: 8ms later (120 Hz) → real delta
    raf.callback?.(1024);
    expect(emulator.tick).toHaveBeenCalledWith(8);

    emulator.onFrame({ width: 2, height: 2, data: new Uint8Array(16), timestamp: 1 });
    expect(putImageData).toHaveBeenCalledOnce();

    // Re-attaching cancels the previous rAF
    renderer.attachTo(emulator);
    expect(cancelSpy).toHaveBeenCalledWith(4);
  });

  // ── Loader tests ──────────────────────────────────────────────────────────

  function makeRenderer(): CanvasRenderer {
    const canvas = document.createElement('canvas');
    canvas.id = 'c64-screen';
    document.body.appendChild(canvas);

    const putImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      putImageData,
    } as unknown as CanvasRenderingContext2D);
    return new CanvasRenderer('c64-screen');
  }

  it('creates loader DOM on first setProgress call', () => {
    const renderer = makeRenderer();

    expect(document.querySelector('.c64-loader')).toBeNull();
    renderer.setProgress(25, 'TESTING...');

    const overlay = document.querySelector('.c64-loader') as HTMLElement;
    expect(overlay).toBeTruthy();

    const label = document.querySelector('.c64-loader-label') as HTMLElement;
    expect(label.textContent).toBe('TESTING...');

    const fill = document.querySelector('.c64-loader-fill') as HTMLElement;
    expect(fill.style.width).toBe('25%');
  });

  it('updates progress on subsequent setProgress calls', () => {
    const renderer = makeRenderer();

    renderer.setProgress(10, 'A');
    renderer.setProgress(75, 'B');

    const fill = document.querySelector('.c64-loader-fill') as HTMLElement;
    expect(fill.style.width).toBe('75%');

    const label = document.querySelector('.c64-loader-label') as HTMLElement;
    expect(label.textContent).toBe('B');
  });

  it('clamps progress to 100%', () => {
    const renderer = makeRenderer();
    renderer.setProgress(150, 'OVER');

    const fill = document.querySelector('.c64-loader-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('setError resets fill and shows error styling', () => {
    const renderer = makeRenderer();
    renderer.setProgress(50, 'LOADING...');
    renderer.setError('SOMETHING BROKE');

    const fill = document.querySelector('.c64-loader-fill') as HTMLElement;
    expect(fill.style.width).toBe('0px');
    expect(fill.style.background).toContain('rgb(255, 68, 68)');

    const label = document.querySelector('.c64-loader-label') as HTMLElement;
    expect(label.textContent).toBe('SOMETHING BROKE');
  });

  it('hideLoader adds hidden class', () => {
    vi.useFakeTimers();
    const renderer = makeRenderer();
    renderer.setProgress(100, 'DONE');

    renderer.hideLoader(0);
    vi.advanceTimersByTime(0);

    const overlay = document.querySelector('.c64-loader') as HTMLElement;
    expect(overlay.classList.contains('hidden')).toBe(true);
    vi.useRealTimers();
  });

  it('injects CSS style tag only once', () => {
    const renderer = makeRenderer();
    renderer.setProgress(10, 'A');
    renderer.setProgress(20, 'B');

    const loaderStyles = document.querySelectorAll('style[data-c64-loader]');
    expect(loaderStyles.length).toBe(1);
  });
});

