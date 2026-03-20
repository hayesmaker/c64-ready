import { C64Emulator } from './emulator/c64-emulator';
import CanvasRenderer from './player/canvas-renderer';

const status = document.getElementById('status')!;
const canvasRenderer = new CanvasRenderer('c64-screen');

C64Emulator.load().then(emulator => {
  canvasRenderer.attachTo(emulator, 10);
  emulator.start();


  status.textContent = `✓ C64 ready — RAM[0x0000] = 0x${emulator.ramRead(0x0000).toString(16).padStart(2, '0')}`;
  status.style.color = '#4f4';
}).catch(err => {
  console.error(err);
  status.textContent = `Error: ${err}`;
  status.style.color = '#f44';
});
