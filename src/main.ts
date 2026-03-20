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
