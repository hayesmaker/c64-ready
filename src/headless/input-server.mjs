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
import { randomBytes } from 'crypto';

/**
 * @param {Object}   opts
 * @param {number}   [opts.port=9001]
 * @param {Function} opts.onInput
 * @param {Function} [opts.onCommand]  Called with emulator commands from the host:
 *                                     { type: 'load-crt'|'detach-crt'|'hard-reset', ... }
 * @param {boolean}  [opts.verbose]
 * @param {number}   [opts.hostTimeoutMs=300000]
 * @param {Function} [opts.validateKickToken]
 * @returns {{ wss: WebSocketServer, close: () => Promise<void> }}
 */
export function createInputServer(opts = {}) {
  const port              = opts.port              ?? 9001;
  const onInput           = opts.onInput;
  const onCommand         = opts.onCommand         ?? (() => {});
  const verbose           = opts.verbose           ?? false;
  const HOST_TIMEOUT      = opts.hostTimeoutMs     ?? 5 * 60 * 1000;
  const validateKickToken = opts.validateKickToken ?? (() => null);

  const wss = new WebSocketServer({ port });

  // ── Room state ────────────────────────────────────────────────────────────
  let hostClient    = null;
  let hostUsername  = null;

  let p2Client      = null;
  let p2Username    = null;
  let inviteToken   = null;

  // Joystick port swap — when true, host uses port 1, P2 uses port 2
  let portsSwapped  = false;
  // Currently loaded cartridge filename (for hello message to late joiners).
  // Seeded from opts.initialCartFilename when a default game is pre-loaded.
  let currentCartFilename = opts.initialCartFilename ?? null;

  function hostPort() { return portsSwapped ? 1 : 2; }
  function p2Port()   { return portsSwapped ? 2 : 1; }

  // ── Host inactivity timeout ───────────────────────────────────────────────
  let hostTimeoutTimer = null;

  function resetHostTimeout() {
    if (!hostClient) return;
    if (hostTimeoutTimer) clearTimeout(hostTimeoutTimer);
    hostTimeoutTimer = setTimeout(() => kickHostForInactivity(), HOST_TIMEOUT);
  }

  function clearHostTimeout() {
    if (hostTimeoutTimer) { clearTimeout(hostTimeoutTimer); hostTimeoutTimer = null; }
  }

  function kickHostForInactivity() {
    if (!hostClient) return;
    if (verbose) console.error(`[input-server] host ${hostUsername} timed out due to inactivity`);
    // Notify the host client they are being kicked
    if (hostClient.readyState === hostClient.OPEN) {
      hostClient.send(JSON.stringify({ type: 'host-timeout-kick', username: hostUsername }));
    }
    const leaving = hostUsername;
    hostClient    = null;
    hostUsername  = null;
    inviteToken   = null;
    clearHostTimeout();
    // Broadcast host-left with reason so clients can show a contextual notice
    broadcastAll({ type: 'host-left', username: leaving, reason: 'timeout' });
    // Auto-promote P2 if present
    promoteP2ToHost();
  }

  // ── P2 → host promotion ───────────────────────────────────────────────────
  // Called whenever the host slot becomes vacant and P2 is connected.
  // Keeps P2's joystick port (1) — just elevates their permissions.
  function promoteP2ToHost() {
    if (!p2Client || p2Client.readyState !== p2Client.OPEN || !p2Username) return;
    hostClient   = p2Client;
    hostUsername = p2Username;
    p2Client     = null;
    p2Username   = null;
    inviteToken  = null;
    if (verbose) console.error(`[input-server] P2 ${hostUsername} promoted to host (joy port unchanged)`);
    // Tell the promoted client
    hostClient.send(JSON.stringify({
      type:         'host-promoted',
      username:     hostUsername,
      joystickPort: 1,   // keep their existing port
    }));
    // Tell everyone else
    broadcastExcept(hostClient, {
      type:         'host-promoted',
      username:     hostUsername,
      joystickPort: 1,
    });
    // Slot is now open again — promoted player was P2, now they're host
    broadcastAll({ type: 'p2-slot-status', open: true });
    // Start inactivity timer for the new host
    resetHostTimeout();
  }

  function broadcastExcept(excludeWs, msg) {
    const raw = JSON.stringify(msg);
    wss.clients.forEach((c) => {
      if (c !== excludeWs && c.readyState === c.OPEN) c.send(raw);
    });
  }

  function broadcastAll(msg) {
    const raw = JSON.stringify(msg);
    wss.clients.forEach((c) => { if (c.readyState === c.OPEN) c.send(raw); });
  }

  // True when the P2 slot is available for open joining
  function isP2SlotOpen() {
    return !!(hostClient && hostClient.readyState === hostClient.OPEN)
        && !(p2Client   && p2Client.readyState   === p2Client.OPEN);
  }

  let clientCount = 0;

  wss.on('listening', () => {
    console.error(`[input-server] WebSocket listening on ws://0.0.0.0:${port}`);
  });

  wss.on('connection', (ws, req) => {
    clientCount++;
    const addr = req.socket.remoteAddress;
    if (verbose) console.error(`[input-server] client connected from ${addr} (${clientCount} total)`);

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
      } catch (err) {
        if (verbose) console.error(`[input-server] bad message:`, err.message);
        return;
      }
      // Avoid re-serialising load-crt messages for logging — the base64 data
      // field can be 100KB+ and JSON.stringify-ing it synchronously on the
      // main thread causes a noticeable pause proportional to file size.
      if (verbose) {
        if (msg.type === 'load-crt') {
          console.error(`[input-server] rx: load-crt filename=${msg.filename ?? '?'} dataLen=${(msg.data ?? '').length}`);
        } else {
          console.error(`[input-server] rx:`, JSON.stringify(msg));
        }
      }

      // ── Host claim ────────────────────────────────────────────────────────
      if (msg.type === 'host') {
        if (hostClient && hostClient.readyState === hostClient.OPEN) {
          ws.send(JSON.stringify({ type: 'host-taken' }));
          return;
        }
        hostClient   = ws;
        hostUsername = msg.username ?? 'player';
        ws.send(JSON.stringify({
          type: 'host-confirmed', username: hostUsername, joystickPort: hostPort(),
          player2: p2Username ? { username: p2Username, joystickPort: p2Port() } : null,
        }));
        broadcastExcept(ws, { type: 'host-joined', username: hostUsername, joystickPort: hostPort() });
        if (verbose) console.error(`[input-server] host claimed by ${hostUsername}`);
        resetHostTimeout();
        // P2 slot just opened (host present, no P2)
        broadcastExcept(ws, { type: 'p2-slot-status', open: isP2SlotOpen() });
        return;
      }

      // ── Swap joystick ports ───────────────────────────────────────────────
      if (msg.type === 'swap-ports') {
        if (ws !== hostClient) return;
        portsSwapped = !portsSwapped;
        if (verbose) console.error(`[input-server] ports swapped: host=${hostPort()} p2=${p2Port()}`);
        broadcastAll({
          type:      'ports-swapped',
          swapped:   portsSwapped,
          hostPort:  hostPort(),
          p2Port:    p2Port(),
        });
        return;
      }
      // ── Voluntary player 2 leave ──────────────────────────────────────────
      if (msg.type === 'p2-leave') {
        if (ws === p2Client) {
          p2Client       = null;
          const leaving  = p2Username;
          p2Username     = null;
          if (verbose) console.error(`[input-server] player2 ${leaving} voluntarily left`);
          ws.send(JSON.stringify({ type: 'player2-left', username: leaving, voluntary: true }));
          broadcastExcept(ws, { type: 'player2-left', username: leaving, voluntary: true });
          broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
        }
        return;
      }

      // ── Voluntary host leave ──────────────────────────────────────────────
      if (msg.type === 'host-leave') {
        if (ws === hostClient) {
          clearHostTimeout();
          hostClient        = null;
          const leaving     = hostUsername;
          hostUsername      = null;
          inviteToken       = null;
          portsSwapped      = false;
          if (verbose) console.error(`[input-server] host ${leaving} voluntarily left`);
          ws.send(JSON.stringify({ type: 'host-left', username: leaving, voluntary: true }));
          broadcastExcept(ws, { type: 'host-left', username: leaving, voluntary: true });
          promoteP2ToHost();
        }
        return;
      }

      // ── Host issues a player-2 invite ─────────────────────────────────────
      if (msg.type === 'invite-p2') {
        if (ws !== hostClient) return;
        if (p2Client && p2Client.readyState === p2Client.OPEN) {
          ws.send(JSON.stringify({ type: 'invite-p2-error', reason: 'slot-taken' }));
          return;
        }
        inviteToken = randomBytes(6).toString('hex');
        ws.send(JSON.stringify({ type: 'invite-token', token: inviteToken }));
        if (verbose) console.error(`[input-server] invite token issued: ${inviteToken}`);
        return;
      }

      // ── Player 2 open join (no token) ────────────────────────────────────
      // Any connected client may join the P2 slot when it is vacant and a
      // host is present. No invite token required.
      if (msg.type === 'join-p2-open') {
        if (!hostClient || hostClient.readyState !== hostClient.OPEN) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'no-host' }));
          return;
        }
        if (p2Client && p2Client.readyState === p2Client.OPEN) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'slot-taken' }));
          return;
        }
        if (ws === hostClient) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'already-host' }));
          return;
        }
        p2Client    = ws;
        p2Username  = msg.username ?? 'player2';
        inviteToken = null; // clear any pending invite — slot is now filled
        ws.send(JSON.stringify({
          type: 'join-p2-confirmed', username: p2Username, joystickPort: p2Port(),
        }));
        broadcastExcept(ws, { type: 'player2-joined', username: p2Username, joystickPort: p2Port() });
        // Notify all clients that the slot is now taken
        broadcastAll({ type: 'p2-slot-status', open: false });
        if (verbose) console.error(`[input-server] player2 open-joined: ${p2Username}`);
        return;
      }

      // ── Player 2 join (invite token) ──────────────────────────────────────
      if (msg.type === 'join-p2') {
        if (!inviteToken || msg.token !== inviteToken) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'invalid-token' }));
          return;
        }
        if (p2Client && p2Client.readyState === p2Client.OPEN) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'slot-taken' }));
          return;
        }
        p2Client    = ws;
        p2Username  = msg.username ?? 'player2';
        inviteToken = null;
        ws.send(JSON.stringify({
          type: 'join-p2-confirmed', username: p2Username, joystickPort: p2Port(),
        }));
        broadcastExcept(ws, { type: 'player2-joined', username: p2Username, joystickPort: p2Port() });
        broadcastAll({ type: 'p2-slot-status', open: false });
        if (verbose) console.error(`[input-server] player2 joined: ${p2Username}`);
        return;
      }

      // ── Host revokes the invite / kicks p2 ───────────────────────────────
      if (msg.type === 'revoke-p2') {
        if (ws !== hostClient) return;
        inviteToken = null;
        if (p2Client && p2Client.readyState === p2Client.OPEN) {
          p2Client.send(JSON.stringify({ type: 'kicked' }));
        }
        const leaving = p2Username;
        p2Client      = null;
        p2Username    = null;
        if (leaving) broadcastAll({ type: 'player2-left', username: leaving });
        broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
        if (verbose) console.error(`[input-server] p2 revoked by host`);
        return;
      }

      // ── Admin kick ────────────────────────────────────────────────────────
      // Requires a valid one-time token issued by the Express server.
      // { type: 'admin-kick', token: '<hex>', target: 'host'|'p2' }
      if (msg.type === 'admin-kick') {
        const valid = validateKickToken(msg.token ?? '');
        if (!valid) {
          ws.send(JSON.stringify({ type: 'admin-kick-error', reason: 'invalid-token' }));
          if (verbose) console.error('[input-server] admin-kick rejected: invalid token');
          return;
        }
        const target = valid.target;
        if (target === 'host' && hostClient) {
          if (verbose) console.error(`[input-server] admin kicked host ${hostUsername}`);
          clearHostTimeout();
          if (hostClient.readyState === hostClient.OPEN) {
            hostClient.send(JSON.stringify({ type: 'host-kicked', reason: 'admin' }));
          }
          const leaving = hostUsername;
          hostClient    = null;
          hostUsername  = null;
          inviteToken   = null;
          broadcastAll({ type: 'host-left', username: leaving, reason: 'admin-kick' });
          promoteP2ToHost();
        } else if (target === 'p2' && p2Client) {
          if (verbose) console.error(`[input-server] admin kicked player2 ${p2Username}`);
          if (p2Client.readyState === p2Client.OPEN) {
            p2Client.send(JSON.stringify({ type: 'kicked', reason: 'admin' }));
          }
          const leaving = p2Username;
          p2Client      = null;
          p2Username    = null;
          broadcastAll({ type: 'player2-left', username: leaving });
        } else {
          ws.send(JSON.stringify({ type: 'admin-kick-error', reason: 'target-not-present' }));
        }
        return;
      }

      // ── Emulator commands (host only) ─────────────────────────────────────
      // load-crt: { type, filename, data: '<base64>' }
      if (msg.type === 'load-crt') {
        if (ws !== hostClient) return;
        if (verbose) console.error(`[input-server] load-crt: ${msg.filename ?? '?'}`);
        const loadFilename = msg.filename ?? '';
        broadcastAll({ type: 'cart-loading', filename: loadFilename });
        // onCommand may return a Promise (deferred async load) or be sync.
        // In either case wait for completion before broadcasting the outcome
        // so clients don't receive cart-loaded before the WASM work is done.
        Promise.resolve()
          .then(() => onCommand({ type: 'load-crt', filename: loadFilename, data: msg.data ?? '' }))
          .then(() => {
            currentCartFilename = loadFilename || null;
            broadcastAll({ type: 'cart-loaded', filename: loadFilename });
          })
          .catch((e) => {
            broadcastAll({ type: 'cart-load-error', reason: String(e?.message ?? e) });
            if (verbose) console.error('[input-server] load-crt error:', e);
          });
        return;
      }

      if (msg.type === 'detach-crt') {
        if (ws !== hostClient) return;
        if (verbose) console.error('[input-server] detach-crt');
        // onCommand returns a Promise (deferred via setImmediate) — wait for
        // completion before broadcasting so clients hear cart-detached only
        // after the WASM work finishes and the event loop is unblocked.
        Promise.resolve()
          .then(() => onCommand({ type: 'detach-crt' }))
          .then(() => {
            currentCartFilename = null;
            broadcastAll({ type: 'cart-detached' });
          })
          .catch((e) => {
            if (verbose) console.error('[input-server] detach-crt error:', e);
          });
        return;
      }

      if (msg.type === 'hard-reset') {
        if (ws !== hostClient) return;
        if (verbose) console.error('[input-server] hard-reset');
        // onCommand returns a Promise (deferred via setImmediate) — wait for
        // completion before broadcasting so clients hear machine-reset only
        // after the WASM work finishes and the event loop is unblocked.
        Promise.resolve()
          .then(() => onCommand({ type: 'hard-reset' }))
          .then(() => {
            broadcastAll({ type: 'machine-reset' });
          })
          .catch((e) => {
            if (verbose) console.error('[input-server] hard-reset error:', e);
          });
        return;
      }

      // ── Input events ─────────────────────────────────────────────────────
      // Accept input from host (port 2) and player 2 (port 1).
      // Any input from the host resets the inactivity timer.
      if (msg.type === 'joystick' || msg.type === 'key') {
        if (ws === hostClient) resetHostTimeout();
        if (onInput) onInput(msg);
        return;
      }

      if (onInput) onInput(msg);
    });

    ws.on('close', () => {
      clientCount--;
      if (verbose) console.error(`[input-server] client disconnected (${clientCount} remaining)`);

      if (ws === hostClient) {
        clearHostTimeout();
        hostClient   = null;
        const leaving = hostUsername;
        hostUsername  = null;
        inviteToken   = null;
        portsSwapped  = false;
        if (verbose) console.error(`[input-server] host ${leaving} disconnected`);
        broadcastExcept(ws, { type: 'host-left', username: leaving });
        promoteP2ToHost();
      }

      if (ws === p2Client) {
        p2Client     = null;
        const leaving = p2Username;
        p2Username    = null;
        if (verbose) console.error(`[input-server] player2 ${leaving} disconnected`);
        broadcastExcept(ws, { type: 'player2-left', username: leaving });
        broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
      }
    });

    ws.on('error', (err) => {
      console.error(`[input-server] ws error:`, err.message);
    });

    // ── Hello handshake ───────────────────────────────────────────────────
    const hostActive = !!(hostClient && hostClient.readyState === hostClient.OPEN);
    ws.send(JSON.stringify({
      type:        'hello',
      protocol:    'c64-input',
      version:     1,
      hostTaken:   hostActive,
      host:        hostActive ? { username: hostUsername, joystickPort: hostPort() } : null,
      player2:     p2Username ? { username: p2Username, joystickPort: p2Port() } : null,
      p2SlotOpen:  isP2SlotOpen(),
      ...(currentCartFilename ? { cartFilename: currentCartFilename } : {}),
      joystickBitmask: { up: 0x1, down: 0x2, left: 0x4, right: 0x8, fire: 0x10 },
    }));
  });

  wss.on('error', (err) => {
    console.error(`[input-server] server error:`, err.message);
  });

  const close = () => new Promise((resolve) => {
    clearHostTimeout();
    wss.close(() => resolve());
  });

  return { wss, close };
}

