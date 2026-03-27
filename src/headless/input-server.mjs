/**
 * Embedded WebSocket input server for remote control.
 *
 * Accepts browser connections on a configurable port (default 9001).
 * Parses incoming JSON messages as InputEvent objects and forwards
 * them to the emulator via an onInput callback.
 *
 * Sends a hello handshake on connect with protocol version and
 * joystick bitmask reference so clients can self-configure.
 */

import { WebSocketServer } from 'ws';

/**
 * @param {Object}   opts
 * @param {number}   [opts.port=9001]  - Listen port
 * @param {Function} opts.onInput      - Called with (inputEvent: object) for each valid message
 * @param {boolean}  [opts.verbose]    - Log connections/messages to stderr
 * @returns {{ wss: WebSocketServer, close: () => Promise<void> }}
 */
export function createInputServer(opts = {}) {
  const port = opts.port ?? 9001;
  const onInput = opts.onInput;
  const verbose = opts.verbose ?? false;

  const wss = new WebSocketServer({ port });
  let clientCount = 0;

  wss.on('listening', () => {
    console.error(`[input-server] WebSocket listening on ws://0.0.0.0:${port}`);
  });

  wss.on('connection', (ws, req) => {
    clientCount++;
    const addr = req.socket.remoteAddress;
    if (verbose) console.error(`[input-server] client connected from ${addr} (${clientCount} total)`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
        if (verbose) console.error(`[input-server] rx:`, JSON.stringify(msg));
        if (onInput) onInput(msg);
      } catch (err) {
        if (verbose) console.error(`[input-server] bad message:`, err.message);
      }
    });

    ws.on('close', () => {
      clientCount--;
      if (verbose) console.error(`[input-server] client disconnected (${clientCount} remaining)`);
    });

    ws.on('error', (err) => {
      console.error(`[input-server] ws error:`, err.message);
    });

    // Send a welcome/handshake so the client knows the protocol version
    ws.send(JSON.stringify({
      type: 'hello',
      protocol: 'c64-input',
      version: 1,
      joystickBitmask: { up: 0x1, down: 0x2, left: 0x4, right: 0x8, fire: 0x10 },
    }));
  });

  wss.on('error', (err) => {
    console.error(`[input-server] server error:`, err.message);
  });

  const close = () => new Promise((resolve) => {
    wss.close(() => resolve());
  });

  return { wss, close };
}

