import { C64Player } from './player/c64-player';
import CanvasRenderer from './player/canvas-renderer';
import UIController from './player/ui-controller';
import { inferLoadTypeFromFilename, isSupportedLoadType } from './player/load-formats';

const status = document.getElementById('status')!;
const renderer = new CanvasRenderer('c64-screen');
const base = import.meta.env.BASE_URL;
const params = new URLSearchParams(window.location.search);

function resolveGameFromParam(raw: string | null, baseUrl: string): string {
  if (!raw) return `${baseUrl}games/cartridges/legend-of-wilf.crt`;
  const value = raw.trim();
  if (!value) return `${baseUrl}games/cartridges/legend-of-wilf.crt`;
  if (value.toLowerCase() === 'null') return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return value;
  return `${baseUrl}${value.replace(/^\/+/, '')}`;
}

const gameUrl = resolveGameFromParam(params.get('game'), base);
const gameType = inferLoadTypeFromFilename(gameUrl || '') ?? 'crt';

// Create player and keep in outer scope so UI can trigger file loads
const player = new C64Player({
  wasmUrl: `${base}c64.wasm`,
  gameUrl,
  gameType,
  renderer,
  onProgress: (pct, label) => renderer.setProgress(pct, label),
});

// Initialise UI with reference to the player (for audio controls)
new UIController().init(player);

player
  .start()
  .then(() => {
    if (!gameUrl) {
      status.textContent = 'Autoload disabled (?game=null)';
      status.style.color = '#9ecbff';
    }
    renderer.hideLoader();
  })
  .catch((err) => {
    console.error(err);
    renderer.setError('ERROR');
    status.textContent = `Error: ${err}`;
    status.style.color = '#f44';
  });

/**
 * @method updateFavicon
 *
 * PowerLED blink on and off when browser focus is on/off.
 * PRO
 */
const updateFavicon = () => {
  const isDimmed = document.hidden;
  const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
  const fileName = isDimmed ? 'led-off.svg' : 'led-on.svg';
  const fullPath = `${base}${fileName}`.replace(/\/+/g, '/');
  if (link) {
    link.href = fullPath;
  }
};

document.addEventListener('visibilitychange', updateFavicon);
window.addEventListener('focus', updateFavicon);
window.addEventListener('blur', updateFavicon);
updateFavicon();

// Listen for files selected via the UI and load into the emulator
window.addEventListener('c64-load-file', async (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const file: File | undefined = detail.file;
  const requestedType = detail.type;
  const loadType = requestedType === 'auto' ? undefined : requestedType;
  if (!file) return;
  try {
    renderer.showLoader();
    await player.loadFile(file, isSupportedLoadType(loadType) ? loadType : undefined);
    renderer.hideLoader();
  } catch (err) {
    console.error(err);
    renderer.setError('LOAD ERROR');
    status.textContent = `Load error: ${err}`;
    status.style.color = '#f44';
  }
});

// Global listener for load errors dispatched by C64Player
window.addEventListener('c64-load-error', (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { error?: string; url?: string; file?: string; type?: string }
    | undefined;
  const msg = detail?.error ?? 'Unknown load error';
  console.error('C64 load error event:', detail);
  renderer.setError('LOAD ERROR');
  status.textContent = `Load error: ${msg}`;
  status.style.color = '#f44';
});

window.addEventListener('c64-load-info', (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { mode?: string; source?: string; message?: string }
    | undefined;
  if (!detail?.message) return;
  status.textContent = detail.message;
  status.style.color = detail.mode === 'warning' ? '#f9c74f' : '#9ecbff';
  console.info('C64 load info event:', detail);
});
