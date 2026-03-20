import { C64Emulator } from './emulator/c64-emulator';

const canvas = document.getElementById('c64-screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const status = document.getElementById('status')!;

C64Emulator.load().then(emulator => {
  // Run enough ticks to let the C64 boot to its blue screen
  emulator.start();
  for (let i = 0; i < 3; i++) emulator.tick(20);

  // Grab the framebuffer and paint it onto the canvas
  const frame = emulator.getFrameBuffer();
  const imageData = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
  ctx.putImageData(imageData, 0, 0);

  status.textContent = `✓ C64 ready — RAM[0x0000] = 0x${emulator.ramRead(0x0000).toString(16).padStart(2, '0')}`;
  status.style.color = '#4f4';
}).catch(err => {
  console.error(err);
  status.textContent = `Error: ${err}`;
  status.style.color = '#f44';
});
