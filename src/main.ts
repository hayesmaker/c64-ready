import { C64Emulator } from './emulator/c64-emulator';
import { C64Player } from './player/c64-player';
import CanvasRenderer from './player/canvas-renderer';
import InputHandler from './player/input-handler';
import UIController from './player/ui-controller';

const status = document.getElementById('status')!;
const canvasRenderer = new CanvasRenderer('c64-screen');
const base = import.meta.env.BASE_URL;

new UIController().init();

(async () => {
  try {
    canvasRenderer.setProgress(10, 'INITIALISING WASM...');
    const emulator = await C64Emulator.load(`${base}c64.wasm`);

    new InputHandler(emulator).attach();
    canvasRenderer.attachTo(emulator);

    const player = new C64Player(emulator);
    await player.loadGame(
      `${base}games/cartridges/legend-of-wilf.crt`,
      'crt',
      (pct, label) => canvasRenderer.setProgress(pct, label),
    );

    emulator.start();
    canvasRenderer.hideLoader();
  } catch (err) {
    console.error(err);
    canvasRenderer.setError('ERROR');
    status.textContent = `Error: ${err}`;
    status.style.color = '#f44';
  }
})();

const updateFavicon = () => {
  const isDimmed = document.hidden;
  const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
  // Use Vite's built-in BASE_URL if available, otherwise fallback to root
  const base = import.meta.env.BASE_URL || '/';
  // Ensure we don't end up with double slashes //
  const fileName = isDimmed ? '/led-off.svg' : 'led-on.svg';
  const fullPath = `${base}${fileName}`.replace(/\/+/g, '/');
  if (link) {
    link.href = fullPath;
  }
};

// Initialize and add listeners
document.addEventListener('visibilitychange', updateFavicon);
// Also handle focus/blur for extra responsiveness
window.addEventListener('focus', updateFavicon);
window.addEventListener('blur', updateFavicon);

updateFavicon(); // Set initial state
