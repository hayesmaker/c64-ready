import { describe, expect, it, vi } from 'vitest';
import {
  isDisplayMode,
  isFillLayout,
  isFullscreenActive,
  isFullscreenSupported,
  resolveDisplayLayout,
  toggleFullscreen,
} from '../../src/player/display-layout';
import type { DisplayContext, DisplayMode } from '../../src/player/display-layout';

const ctx = (overrides: Partial<DisplayContext> = {}): DisplayContext => ({
  fullscreen: false,
  touch: false,
  portrait: false,
  ...overrides,
});

describe('resolveDisplayLayout', () => {
  it.each<[DisplayMode, Partial<DisplayContext>, string]>([
    ['standard', {}, 'standard'],
    ['standard', { portrait: true }, 'standard'],
    ['standard', { touch: true, portrait: true }, 'fill-width'],
    ['standard', { touch: true, portrait: false }, 'contain'],
    ['standard', { fullscreen: true }, 'contain'],
    ['standard', { fullscreen: true, touch: true, portrait: true }, 'contain'],
    ['full', {}, 'contain'],
    ['full', { touch: true, portrait: true }, 'contain'],
    ['stretch', {}, 'stretch'],
    ['stretch', { fullscreen: true, touch: true }, 'stretch'],
  ])('%s with %o → %s', (mode, context, expected) => {
    expect(resolveDisplayLayout(mode, ctx(context))).toBe(expected);
  });
});

describe('display mode helpers', () => {
  it('validates display modes', () => {
    expect(isDisplayMode('standard')).toBe(true);
    expect(isDisplayMode('full')).toBe(true);
    expect(isDisplayMode('stretch')).toBe(true);
    expect(isDisplayMode('fullscreen')).toBe(false);
    expect(isDisplayMode(null)).toBe(false);
  });

  it('treats contain and stretch as viewport-filling layouts', () => {
    expect(isFillLayout('contain')).toBe(true);
    expect(isFillLayout('stretch')).toBe(true);
    expect(isFillLayout('standard')).toBe(false);
    expect(isFillLayout('fill-width')).toBe(false);
  });
});

function fakeDocument(opts: {
  standard?: boolean;
  webkit?: boolean;
  enabled?: boolean;
  active?: boolean;
}): Document {
  const documentElement: Record<string, unknown> = {};
  const doc: Record<string, unknown> = { documentElement };
  if (opts.standard) {
    documentElement.requestFullscreen = vi.fn(async () => undefined);
    doc.exitFullscreen = vi.fn(async () => undefined);
    doc.fullscreenElement = opts.active ? documentElement : null;
    if (opts.enabled !== undefined) doc.fullscreenEnabled = opts.enabled;
  }
  if (opts.webkit) {
    documentElement.webkitRequestFullscreen = vi.fn();
    doc.webkitExitFullscreen = vi.fn();
    doc.webkitFullscreenElement = opts.active ? documentElement : null;
  }
  return doc as unknown as Document;
}

describe('fullscreen helpers', () => {
  it('reports no support when there is no fullscreen API (iPhone Safari)', () => {
    expect(isFullscreenSupported(fakeDocument({}))).toBe(false);
  });

  it('reports support for the standard and webkit-prefixed APIs', () => {
    expect(isFullscreenSupported(fakeDocument({ standard: true }))).toBe(true);
    expect(isFullscreenSupported(fakeDocument({ webkit: true }))).toBe(true);
  });

  it('reports no support when fullscreen is disabled (e.g. iframe without allowfullscreen)', () => {
    expect(isFullscreenSupported(fakeDocument({ standard: true, enabled: false }))).toBe(false);
  });

  it('requests fullscreen on the whole page when not active', async () => {
    const doc = fakeDocument({ standard: true });
    expect(isFullscreenActive(doc)).toBe(false);
    await toggleFullscreen(doc);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('exits fullscreen when active', async () => {
    const doc = fakeDocument({ standard: true, active: true });
    expect(isFullscreenActive(doc)).toBe(true);
    await toggleFullscreen(doc);
    expect(doc.exitFullscreen).toHaveBeenCalled();
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it('falls back to the webkit-prefixed API', async () => {
    const enter = fakeDocument({ webkit: true }) as Document & Record<string, any>;
    await toggleFullscreen(enter);
    expect(
      (enter.documentElement as HTMLElement & Record<string, unknown>).webkitRequestFullscreen,
    ).toHaveBeenCalled();

    const exit = fakeDocument({ webkit: true, active: true }) as Document & Record<string, any>;
    await toggleFullscreen(exit);
    expect(exit.webkitExitFullscreen).toHaveBeenCalled();
  });
});
