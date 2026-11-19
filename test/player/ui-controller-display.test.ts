import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UIController from '../../src/player/ui-controller';
import { DISPLAY_MODE_STORAGE_KEY } from '../../src/player/display-layout';

type MediaState = { touch: boolean; portrait: boolean };

function stubMatchMedia(state: MediaState) {
  const listeners = new Map<string, Set<() => void>>();
  const matches = (query: string) =>
    query.includes('pointer: coarse')
      ? state.touch
      : query.includes('orientation: portrait')
        ? state.portrait
        : false;
  window.matchMedia = vi.fn((query: string) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    return {
      media: query,
      get matches() {
        return matches(query);
      },
      addEventListener: (_: string, cb: () => void) => listeners.get(query)!.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.get(query)!.delete(cb),
    } as unknown as MediaQueryList;
  });
  /** Simulate a device change (e.g. rotation) and fire change listeners. */
  return (next: Partial<MediaState>) => {
    Object.assign(state, next);
    listeners.forEach((set) => set.forEach((cb) => cb()));
  };
}

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el });
}

const root = document.documentElement;
const layout = () => root.getAttribute('data-c64-layout');

describe('UIController display layout', () => {
  beforeEach(() => {
    document.body.innerHTML = '<canvas id="c64-screen" width="384" height="272"></canvas>';
    document.querySelectorAll('style[data-c64-help]').forEach((el) => el.remove());
    ['data-c64-layout', 'data-c64-fill', 'data-c64-fullscreen'].forEach((a) =>
      root.removeAttribute(a),
    );
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: vi.fn(() => []),
    });
    window.localStorage.clear();
    setFullscreenElement(null);
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    root.requestFullscreen = vi.fn(async () => {
      setFullscreenElement(root);
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    document.exitFullscreen = vi.fn(async () => {
      setFullscreenElement(null);
      document.dispatchEvent(new Event('fullscreenchange'));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the standard layout on desktop by default', () => {
    stubMatchMedia({ touch: false, portrait: false });
    new UIController().init();
    expect(layout()).toBe('standard');
    expect(root.hasAttribute('data-c64-fill')).toBe(false);
    expect(document.getElementById('c64-screen')!.getAttribute('data-display-mode')).toBe(
      'standard',
    );
  });

  it('fills the width in portrait and the height in landscape on touch devices', () => {
    const change = stubMatchMedia({ touch: true, portrait: true });
    new UIController().init();
    expect(layout()).toBe('fill-width');
    expect(root.hasAttribute('data-c64-fill')).toBe(false);

    change({ portrait: false }); // rotate to landscape
    expect(layout()).toBe('contain');
    expect(root.hasAttribute('data-c64-fill')).toBe(true);
  });

  it('applies and persists the mode chosen in settings', () => {
    stubMatchMedia({ touch: false, portrait: false });
    const events: string[] = [];
    window.addEventListener('c64-display-mode-changed', (e) =>
      events.push((e as CustomEvent).detail.mode),
    );
    new UIController().init();

    const stretch = document.querySelector<HTMLInputElement>(
      'input[name="c64-display-mode"][value="stretch"]',
    )!;
    stretch.checked = true;
    stretch.dispatchEvent(new Event('change'));

    expect(layout()).toBe('stretch');
    expect(root.hasAttribute('data-c64-fill')).toBe(true);
    expect(window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY)).toBe('stretch');
    expect(events.at(-1)).toBe('stretch');
    // no inline sizing — layout is CSS-driven
    expect(document.getElementById('c64-screen')!.getAttribute('style')).toBeNull();
  });

  it('restores the saved display mode and ignores invalid values', () => {
    stubMatchMedia({ touch: false, portrait: false });
    window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, 'full');
    const ui = new UIController();
    ui.init();
    expect(ui.getDisplayMode()).toBe('full');
    expect(layout()).toBe('contain');
    expect(
      document.querySelector<HTMLInputElement>('input[name="c64-display-mode"][value="full"]')!
        .checked,
    ).toBe(true);

    document.body.innerHTML = '';
    window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, 'bogus');
    const ui2 = new UIController();
    ui2.init();
    expect(ui2.getDisplayMode()).toBe('standard');
  });

  it('toggles fullscreen from the floating button and uses the contain layout', async () => {
    stubMatchMedia({ touch: false, portrait: false });
    new UIController().init();
    const btn = document.querySelector<HTMLButtonElement>('.c64-fullscreen-btn')!;
    expect(btn).not.toBeNull();
    expect(btn.title).toBe('Fullscreen');

    btn.click();
    await vi.waitFor(() => expect(root.requestFullscreen).toHaveBeenCalled());
    expect(layout()).toBe('contain');
    expect(root.hasAttribute('data-c64-fullscreen')).toBe(true);
    expect(btn.title).toBe('Exit fullscreen');

    btn.click();
    await vi.waitFor(() => expect(document.exitFullscreen).toHaveBeenCalled());
    expect(layout()).toBe('standard');
    expect(btn.title).toBe('Fullscreen');
  });

  it('hides fullscreen controls when the Fullscreen API is unavailable', () => {
    stubMatchMedia({ touch: true, portrait: true });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    new UIController().init();
    expect(document.querySelector('.c64-fullscreen-btn')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('#c64-fullscreen-toggle')!.hidden).toBe(true);
  });
});

describe('UIController keyboard map', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: vi.fn(() => []),
    });
  });

  it('opens the full keyboard map from the help dialog and closes back to help', () => {
    const ui = new UIController();
    ui.init();
    ui.open();

    const keymap = document.querySelector('.c64-keymap-overlay')!;
    expect(keymap.classList.contains('visible')).toBe(false);

    document.querySelector<HTMLAnchorElement>('#c64-view-keymap')!.click();
    expect(keymap.classList.contains('visible')).toBe(true);

    const sections = Array.from(keymap.querySelectorAll('h3')).map((h) => h.textContent);
    expect(sections).toEqual(['Joystick', 'Emulator', 'C64 keyboard']);
    const labels = Array.from(keymap.querySelectorAll('li > span:first-child')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(expect.arrayContaining(['Restore', 'Colon / Semicolon', 'Slash']));

    keymap.querySelector<HTMLButtonElement>('.c64-help-close')!.click();
    expect(keymap.classList.contains('visible')).toBe(false);
    expect(document.querySelector('.c64-help-overlay')!.classList.contains('visible')).toBe(true);
  });

  it('closing help also closes the keyboard map', () => {
    const ui = new UIController();
    ui.init();
    ui.open();
    document.querySelector<HTMLAnchorElement>('#c64-view-keymap')!.click();
    ui.close();
    expect(document.querySelector('.c64-keymap-overlay')!.classList.contains('visible')).toBe(
      false,
    );
  });
});
