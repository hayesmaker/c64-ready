import { C64Player } from './player/c64-player';
import CanvasRenderer from './player/canvas-renderer';
import UIController from './player/ui-controller';
import CheevosDevController, { parseCheevosSetJson } from './player/cheevos-dev';
import CheevosTrackerPanel from './player/cheevos-tracker-panel';
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

function resolveUrlFromParam(raw: string | null, baseUrl: string): string {
  if (!raw) return '';
  const value = raw.trim();
  if (!value) return '';
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
  audio: { assetBaseUrl: base },
  onProgress: (pct, label) => renderer.setProgress(pct, label),
});
const cheevosDev = new CheevosDevController(player);
const cheevosTrackerPanel = new CheevosTrackerPanel();
cheevosTrackerPanel.init();

// Initialise UI with reference to the player (for audio controls)
new UIController({ assetBaseUrl: base }).init(player);

player
  .start()
  .then(async () => {
    if (!gameUrl) {
      status.textContent = 'Autoload disabled (?game=null)';
      status.style.color = '#9ecbff';
    }
    renderer.hideLoader();
    await enableCheevosFromParams();
  })
  .catch((err) => {
    console.error(err);
    renderer.setError('ERROR');
    status.textContent = `Error: ${normalizeErrorMessage(String(err))}`;
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
    status.textContent = `Load error: ${normalizeErrorMessage(String(err))}`;
    status.style.color = '#f44';
  }
});

window.addEventListener('c64-controller-connected', (e: Event) => {
  const detail = (e as CustomEvent).detail;
  status.textContent = `Controller Connected: ${detail.index} - ${detail.name}`;
  status.style.color = '#9ecbff';
});

window.addEventListener('c64-controller-disconnected', (e: Event) => {
  const detail = (e as CustomEvent).detail;
  status.textContent = `Controller Disconnected : ${detail.index} - ${detail.name}`;
  status.style.color = '#9ecbff';
});

window.addEventListener('c64-load-tool', async (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { name?: string; url?: string; type?: string }
    | undefined;
  if (!detail?.url) return;
  const loadType = isSupportedLoadType(detail.type) ? detail.type : undefined;
  try {
    status.textContent = `Loading tool: ${detail.name ?? detail.url}`;
    status.style.color = '#9ecbff';
    renderer.showLoader();
    await player.loadTool(detail.url, loadType);
    renderer.hideLoader();
  } catch (err) {
    console.error(err);
    renderer.setError('LOAD ERROR');
    status.textContent = `Tool load error: ${normalizeErrorMessage(String(err))}`;
    status.style.color = '#f44';
  }
});

window.addEventListener('c64-cheevos-enable', async (e: Event) => {
  const detail = (e as CustomEvent<{ detectorId?: string; jsonText?: string }>).detail;
  const detectorId = detail?.detectorId?.trim() ?? '';
  if (!detectorId) return;
  try {
    if (detail?.jsonText?.trim()) {
      await cheevosDev.enableFromJson(detectorId, detail.jsonText);
    } else {
      await cheevosDev.enable(detectorId);
    }
  } catch (err) {
    const msg = normalizeErrorMessage(String((err as Error)?.message ?? err));
    window.dispatchEvent(
      new CustomEvent('c64-cheevos-error', { detail: { detectorId, error: msg } }),
    );
  }
});

window.addEventListener('c64-cheevos-disable', () => {
  cheevosDev.disable();
  status.textContent = 'Cheevos dev tracking disabled';
  status.style.color = '#9ecbff';
});

window.addEventListener('c64-cheevos-clear-popped', (e: Event) => {
  const detail = (e as CustomEvent<{ detectorId?: string }>).detail;
  cheevosDev.clearPopped(detail?.detectorId);
});

window.addEventListener('c64-cheevos-clear-scores', (e: Event) => {
  const detail = (e as CustomEvent<{ detectorId?: string }>).detail;
  cheevosDev.clearScores(detail?.detectorId);
});

// Global listener for load errors dispatched by C64Player
window.addEventListener('c64-load-error', (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { error?: string; url?: string; file?: string; type?: string }
    | undefined;
  const msg = normalizeErrorMessage(detail?.error ?? 'Unknown load error');
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

window.addEventListener('c64-cheevos-status', (e: Event) => {
  const detail = (e as CustomEvent<{ detectorId?: string; status?: string; cheevosCount?: number }>)
    .detail;
  if (detail?.status !== 'enabled') return;
  status.textContent = `Cheevos tracking enabled: ${detail.detectorId ?? 'unknown'} (${detail.cheevosCount ?? 0} achievements)`;
  status.style.color = '#9ecbff';
});

window.addEventListener('c64-cheevos-error', (e: Event) => {
  const detail = (e as CustomEvent<{ detectorId?: string; error?: string }>).detail;
  status.textContent = `Cheevos error${detail?.detectorId ? ` (${detail.detectorId})` : ''}: ${detail?.error ?? 'Unknown error'}`;
  status.style.color = '#f44';
});

window.addEventListener('c64-cheevos-score', (e: Event) => {
  const detail = (e as CustomEvent<{ detectorId?: string; score?: { score?: number } }>).detail;
  status.textContent = `Cheevos score captured${detail?.detectorId ? ` for ${detail.detectorId}` : ''}: ${detail?.score?.score ?? 0}`;
  status.style.color = '#9ecbff';
});

window.addEventListener('c64-cheevos-event', (e: Event) => {
  const detail = (
    e as CustomEvent<{
      detectorId?: string;
      type?: string;
      payload?: { title?: string; message?: string; score?: number };
    }>
  ).detail;
  if (!detail?.type) return;
  if (detail.type === 'cheevo') {
    status.textContent = `${detail.payload?.title ?? 'Achievement'}: ${detail.payload?.message ?? 'Unlocked'}`;
  } else if (detail.type === 'gameOver') {
    status.textContent = `Game over${detail.detectorId ? ` (${detail.detectorId})` : ''}: ${detail.payload?.score ?? 0}`;
  } else {
    return;
  }
  status.style.color = '#9ecbff';
});

window.addEventListener('c64-reboot', () => {
  status.textContent = 'Emulator rebooted. Load a cartridge to continue.';
  status.style.color = '#9ecbff';
  renderer.hideLoader(0);
});

function normalizeErrorMessage(msg: string): string {
  let out = String(msg ?? '').trim();
  while (/^(uncaught\s+)?error\s*:\s*/i.test(out)) {
    out = out.replace(/^(uncaught\s+)?error\s*:\s*/i, '').trim();
  }
  return out || 'Unknown load error';
}

async function enableCheevosFromParams(): Promise<void> {
  const detectorId = params.get('cheevos')?.trim();
  if (!detectorId) return;

  const cheevosSetUrl = resolveUrlFromParam(params.get('cheevosSet'), base);
  try {
    if (cheevosSetUrl) {
      const res = await fetch(cheevosSetUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to fetch cheevos set: ${res.status}`);
      await cheevosDev.enable(detectorId, parseCheevosSetJson(await res.text()));
      return;
    }
    await cheevosDev.enable(detectorId);
  } catch (err) {
    const msg = normalizeErrorMessage(String((err as Error)?.message ?? err));
    window.dispatchEvent(
      new CustomEvent('c64-cheevos-error', { detail: { detectorId, error: msg } }),
    );
  }
}
