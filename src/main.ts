import { C64Player } from './player/c64-player';
import CanvasRenderer from './player/canvas-renderer';
import UIController from './player/ui-controller';

const status = document.getElementById('status')!;
const renderer = new CanvasRenderer('c64-screen');
const base = import.meta.env.BASE_URL;

new UIController().init();

const player = new C64Player({
  wasmUrl: `${base}c64.wasm`,
  gameUrl: `${base}games/cartridges/legend-of-wilf.crt`,
  renderer,
  onProgress: (pct, label) => renderer.setProgress(pct, label),
});

player
  .start()
  .then(() => {
    renderer.hideLoader();
  })
  .catch((err) => {
    console.error(err);
    renderer.setError('ERROR');
    status.textContent = `Error: ${err}`;
    status.style.color = '#f44';
  });

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
