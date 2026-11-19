/**
 * Responsive display layout for the browser player.
 *
 * The user-facing display *mode* (Settings → Display) is combined with the
 * device context (fullscreen, touch device, orientation) to produce a concrete
 * *layout*, which is written to `<html data-c64-layout="…">`. All sizing is
 * done by the CSS below so the canvas follows viewport / rotation changes
 * without any JS resize handling.
 */

export type DisplayMode = 'standard' | 'full' | 'stretch';

/**
 * - `standard`   — desktop default: up to 2x (768×544) with a border, scaled down to fit.
 * - `fill-width` — touch portrait default: the full width of the screen.
 * - `contain`    — largest size that fits the viewport, aspect ratio kept
 *                  (fills the height on landscape phones / tablets).
 * - `stretch`    — fill the whole viewport, aspect ratio ignored.
 */
export type DisplayLayout = 'standard' | 'fill-width' | 'contain' | 'stretch';

export interface DisplayContext {
  fullscreen: boolean;
  touch: boolean;
  portrait: boolean;
}

export const DISPLAY_MODES: readonly DisplayMode[] = ['standard', 'full', 'stretch'];
export const DISPLAY_MODE_STORAGE_KEY = 'c64-display-mode';

/** Media query identifying phones / tablets (no hover, coarse pointer). */
export const TOUCH_DEVICE_QUERY = '(hover: none) and (pointer: coarse)';
export const PORTRAIT_QUERY = '(orientation: portrait)';

export function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value);
}

export function resolveDisplayLayout(mode: DisplayMode, ctx: DisplayContext): DisplayLayout {
  if (mode === 'stretch') return 'stretch';
  if (mode === 'full') return 'contain';
  if (ctx.fullscreen) return 'contain';
  if (ctx.touch) return ctx.portrait ? 'fill-width' : 'contain';
  return 'standard';
}

/** Layouts that take over the whole viewport (no page scrolling, overlays dimmed). */
export function isFillLayout(layout: DisplayLayout): boolean {
  return layout === 'contain' || layout === 'stretch';
}

// Every dvh rule is preceded by a vh fallback for older browsers.
export const displayLayoutCss = `
html[data-c64-layout=fill-width] #c64-screen{border:none;width:100vw;height:auto}
html[data-c64-layout=contain] #c64-screen{border:none;height:auto;width:min(100vw,calc(100vh * 384 / 272));width:min(100vw,calc(100dvh * 384 / 272))}
html[data-c64-layout=stretch] #c64-screen{border:none;aspect-ratio:auto;object-fit:fill;width:100vw;height:100vh;height:100dvh}
html[data-c64-fill],html[data-c64-fill] body{overflow:hidden;overscroll-behavior:none}
html[data-c64-fill] body{height:100vh;height:100dvh;min-height:0}
html[data-c64-fill] .c64-help-btn,html[data-c64-fill] .c64-hamburger,html[data-c64-fill] .c64-fullscreen-btn,html[data-c64-fill] .c64-unmute-btn:not(.hidden){opacity:.4;transition:opacity .2s ease}
html[data-c64-fill] .c64-help-btn:hover,html[data-c64-fill] .c64-hamburger:hover,html[data-c64-fill] .c64-fullscreen-btn:hover,html[data-c64-fill] .c64-unmute-btn:not(.hidden):hover,html[data-c64-fill] .c64-help-btn:focus-visible,html[data-c64-fill] .c64-hamburger:focus-visible,html[data-c64-fill] .c64-fullscreen-btn:focus-visible{opacity:1}
html[data-c64-fill] .c64-loader{position:fixed;left:50%;bottom:16px;margin:0;translate:-50% 0;z-index:950}
.c64-fullscreen-btn{position:fixed;top:12px;right:56px;width:36px;height:36px;padding:0;border-radius:6px;border:2px solid #444;background:#111;color:#ddd;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1000}
.c64-fullscreen-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
`;

export const FULLSCREEN_ENTER_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
export const FULLSCREEN_EXIT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** iPhone Safari has no element fullscreen API — the button is hidden there. */
export function isFullscreenSupported(doc: Document = document): boolean {
  const d = doc as FullscreenDocument;
  const el = d.documentElement as FullscreenElement;
  const canRequest =
    typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
  const enabled = d.fullscreenEnabled ?? d.webkitFullscreenEnabled ?? canRequest;
  return canRequest && enabled !== false;
}

export function isFullscreenActive(doc: Document = document): boolean {
  const d = doc as FullscreenDocument;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export async function toggleFullscreen(doc: Document = document): Promise<void> {
  const d = doc as FullscreenDocument;
  if (isFullscreenActive(d)) {
    await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
    return;
  }
  // Fullscreen the whole page (not just the canvas) so the menu, help and
  // unmute overlays keep working while in fullscreen.
  const el = d.documentElement as FullscreenElement;
  if (el.requestFullscreen) {
    await el.requestFullscreen({ navigationUI: 'hide' });
  } else {
    await el.webkitRequestFullscreen?.();
  }
}
