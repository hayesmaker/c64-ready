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
 * @param {string}   [opts.serverVersion]   Package version string, e.g. '0.7.0'
 * @param {string}   [opts.serverGitHash]   Abbreviated git commit hash, e.g. '16e86cd'
 * @returns {{ wss: WebSocketServer, close: () => Promise<void> }}
 */
export function createInputServer(opts = {}) {
  const port              = opts.port              ?? 9001;
  const onInput           = opts.onInput;
  const onCommand         = opts.onCommand         ?? (() => {});
  const verbose           = opts.verbose           ?? false;
  const logEvents         = opts.logEvents         ?? false;
  const HOST_TIMEOUT      = opts.hostTimeoutMs     ?? 10 * 60 * 1000;
  const validateKickToken = opts.validateKickToken ?? (() => null);
  const serverVersion     = opts.serverVersion     ?? null;
  const serverGitHash     = opts.serverGitHash     ?? null;

  // ── Input flood instrumentation ───────────────────────────────────────────────
  const _inputStats = {
    host: { joystick: 0, key: 0, lastMsgTime: 0 },
    p2:   { joystick: 0, key: 0, lastMsgTime: 0 },
  };
  // ── Input latency tracking ─────────────────────────────────────────────────
  const LATENCY_SPIKE_MS = 200;
  const _latencyCount = { host: 0, p2: 0 };
  const _avgLatency = { host: 0, p2: 0 };
  let _latencyLogTimer = null;
  let _inputLogTimer = null;
  const _networkStats = {
    host: { avgLatency: null, lastLatency: null, lastSpikeLatency: null, lastSpikeAt: null },
    p2:   { avgLatency: null, lastLatency: null, lastSpikeLatency: null, lastSpikeAt: null },
  };

  function broadcastNetworkStats() {
    if (!hostClient && !p2Client) return;
    const payload = JSON.stringify({
      type: 'network-stats',
      serverTime: Date.now(),
      host: { ..._networkStats.host },
      p2:   { ..._networkStats.p2 },
    });
    if (hostClient && hostClient.readyState === hostClient.OPEN) {
      try { hostClient.send(payload); } catch (_) {}
    }
    if (p2Client && p2Client.readyState === p2Client.OPEN) {
      try { p2Client.send(payload); } catch (_) {}
    }
  }
  const INPUT_LOG_INTERVAL_MS = 5000; // every 5 seconds

  function _startInputLog() {
    if (_inputLogTimer) return;
    _inputLogTimer = setInterval(() => {
      const now = Date.now();
      // Only log if there's been recent activity (within last 10s)
      const h = _inputStats.host.lastMsgTime && (now - _inputStats.host.lastMsgTime < 10000);
      const p = _inputStats.p2.lastMsgTime && (now - _inputStats.p2.lastMsgTime < 10000);
      if (h || p) {
        console.error(`[input-flood] host joystick=${_inputStats.host.joystick} key=${_inputStats.host.key} | p2 joystick=${_inputStats.p2.joystick} key=${_inputStats.p2.key}`);
      }
      // Reset counters after reporting
      _inputStats.host.joystick = 0;
      _inputStats.host.key = 0;
      _inputStats.p2.joystick = 0;
      _inputStats.p2.key = 0;
    }, INPUT_LOG_INTERVAL_MS);
  }

  /** Emit a structured event log line — only when --log-events is active.
   *  Format: [event] <tag> key=value ...
   *  Never called per-frame; only on meaningful state transitions. */
  function logEv(tag, fields = {}) {
    if (!logEvents) return;
    const ts = new Date().toISOString();
    const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    console.error(`[event] ${ts} ${tag}${pairs ? ' ' + pairs : ''}`);
  }

  const wss = new WebSocketServer({ port });
  const HOST_RECONNECT_GRACE = opts.hostReconnectGraceMs ?? 8_000;

  // ── Room state ────────────────────────────────────────────────────────────
  let hostClient    = null;
  let hostUsername  = null;

  let p2Client      = null;
  let p2Username    = null;
  let inviteToken   = null;

  // Joystick port swap — when true, host uses port 1, P2 uses port 2
  let portsSwapped  = false;

  // ── Host reconnect grace period ───────────────────────────────────────────
  // When the host disconnects we hold off on promoting P2 for up to
  // HOST_RECONNECT_GRACE ms, giving the host a chance to refresh and reclaim.
  let graceTimer          = null;
  let pendingHostUsername = null;  // username of the disconnected host
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

  // ── P2 inactivity timeout ─────────────────────────────────────────────────
  let p2TimeoutTimer = null;

  function resetP2Timeout() {
    if (!p2Client) return;
    if (p2TimeoutTimer) clearTimeout(p2TimeoutTimer);
    p2TimeoutTimer = setTimeout(() => kickP2ForInactivity(), HOST_TIMEOUT);
  }

  function clearP2Timeout() {
    if (p2TimeoutTimer) { clearTimeout(p2TimeoutTimer); p2TimeoutTimer = null; }
  }

  function kickP2ForInactivity() {
    if (!p2Client) return;
    if (verbose) console.error(`[input-server] p2 ${p2Username} timed out due to inactivity`);
    logEv('p2-timeout', { username: p2Username });
    if (p2Client.readyState === p2Client.OPEN) {
      p2Client.send(JSON.stringify({ type: 'p2-timeout-kick', username: p2Username }));
    }
    const leaving = p2Username;
    p2Client      = null;
    p2Username    = null;
    clearP2Timeout();
    broadcastAll({ type: 'player2-left', username: leaving, reason: 'timeout' });
    broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
  }

  // ── Host reconnect grace period helpers ───────────────────────────────────
  function clearGrace() {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    pendingHostUsername = null;
  }

  // Called when grace expires without the host reconnecting.
  function expireGrace() {
    graceTimer          = null;
    const leaving       = pendingHostUsername;
    pendingHostUsername = null;
    if (verbose) console.error(`[input-server] host grace expired for ${leaving}`);
    logEv('host-grace-expired', { username: leaving });
    broadcastAll({ type: 'host-left', username: leaving, reason: 'disconnect' });
    broadcastAll({ type: 'p2-slot-status', open: false });
  }

  // Called on host WS close — starts grace period, notifies clients.
  function onHostDisconnect(leaving) {
    clearGrace();
    pendingHostUsername = leaving;
    if (verbose) console.error(`[input-server] host ${leaving} disconnected — grace ${HOST_RECONNECT_GRACE}ms`);
    logEv('host-disconnected', { username: leaving, graceMs: HOST_RECONNECT_GRACE });
    // Tell everyone the host is temporarily gone; P2 should wait before acting.
    broadcastAll({ type: 'host-disconnected', username: leaving, graceMs: HOST_RECONNECT_GRACE });
    graceTimer = setTimeout(expireGrace, HOST_RECONNECT_GRACE);
  }

  function kickHostForInactivity() {
    if (!hostClient) return;
    if (verbose) console.error(`[input-server] host ${hostUsername} timed out due to inactivity`);
    logEv('host-timeout', { username: hostUsername });
    // Notify the host client they are being kicked
    if (hostClient.readyState === hostClient.OPEN) {
      hostClient.send(JSON.stringify({ type: 'host-timeout-kick', username: hostUsername }));
    }
    const leaving = hostUsername;
    hostClient    = null;
    hostUsername  = null;
    inviteToken   = null;
    clearHostTimeout();
    clearGrace();
    // Broadcast host-left with reason so clients can show a contextual notice
    broadcastAll({ type: 'host-left', username: leaving, reason: 'timeout' });
    broadcastAll({ type: 'p2-slot-status', open: false });
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
    logEv('server-listening', { port });
    // Start input flood logging
    _startInputLog();
  });

  wss.on('connection', (ws, req) => {
    clientCount++;
    const addr = req.socket.remoteAddress;
    if (verbose) console.error(`[input-server] client connected from ${addr} (${clientCount} total)`);
    logEv('client-connected', { addr, total: clientCount });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
      } catch (err) {
        if (verbose) console.error(`[input-server] bad message:`, err.message);
        logEv('error', { kind: 'bad-message', err: err.message });
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
          // force:true lets a new connection take over from a stale/ghost host
          // (e.g. page reload, WebRTC reconnect, or lost tab).  Without this
          // the new browser tab gets host-taken and detach/reset silently fail.
          if (!msg.force) {
            ws.send(JSON.stringify({ type: 'host-taken' }));
            logEv('host-claim-rejected', { reason: 'slot-taken', username: msg.username ?? 'player' });
            return;
          }
          // Forcibly evict the existing host before granting the new claim.
          if (verbose) console.error(`[input-server] force host claim — evicting ${hostUsername}`);
          logEv('host-force-evicted', { evicted: hostUsername, by: msg.username ?? 'player' });
          clearHostTimeout();
          clearGrace();
          try { hostClient.send(JSON.stringify({ type: 'host-evicted', reason: 'force-claim' })); } catch (_) {}
          try { hostClient.close(); } catch (_) {}
          hostClient   = null;
          hostUsername = null;
          inviteToken  = null;
        }
        const isRejoin = graceTimer && pendingHostUsername === (msg.username ?? 'player');
        if (graceTimer) clearGrace(); // cancel grace regardless of who's claiming
        hostClient   = ws;
        hostUsername = msg.username ?? 'player';
        ws.send(JSON.stringify({
          type: 'host-confirmed', username: hostUsername, joystickPort: hostPort(),
          player2: p2Username ? { username: p2Username, joystickPort: p2Port() } : null,
        }));
        if (isRejoin) {
          broadcastExcept(ws, { type: 'host-rejoined', username: hostUsername, joystickPort: hostPort() });
        } else {
          broadcastExcept(ws, { type: 'host-joined', username: hostUsername, joystickPort: hostPort() });
        }
        if (verbose) console.error(`[input-server] host ${isRejoin ? 're' : ''}claimed by ${hostUsername}`);
        logEv(isRejoin ? 'host-rejoined' : 'host-joined', { username: hostUsername, joystickPort: hostPort() });
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
        logEv('ports-swapped', { hostPort: hostPort(), p2Port: p2Port() });
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
          clearP2Timeout();
          p2Client       = null;
          const leaving  = p2Username;
          p2Username     = null;
          if (verbose) console.error(`[input-server] player2 ${leaving} voluntarily left`);
          logEv('p2-left', { username: leaving, reason: 'voluntary' });
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
          clearGrace();
          hostClient        = null;
          const leaving     = hostUsername;
          hostUsername      = null;
          inviteToken       = null;
          portsSwapped      = false;
          if (verbose) console.error(`[input-server] host ${leaving} voluntarily left`);
          logEv('host-left', { username: leaving, reason: 'voluntary' });
          ws.send(JSON.stringify({ type: 'host-left', username: leaving, voluntary: true }));
          broadcastExcept(ws, { type: 'host-left', username: leaving, voluntary: true });
          broadcastAll({ type: 'p2-slot-status', open: false });
        }
        return;
      }

      // ── Host issues a player-2 invite ─────────────────────────────────────
      if (msg.type === 'invite-p2') {
        if (ws !== hostClient) return;
        if (p2Client && p2Client.readyState === p2Client.OPEN) {
          ws.send(JSON.stringify({ type: 'invite-p2-error', reason: 'slot-taken' }));
          logEv('invite-p2-rejected', { reason: 'slot-taken' });
          return;
        }
        inviteToken = randomBytes(6).toString('hex');
        ws.send(JSON.stringify({ type: 'invite-token', token: inviteToken }));
        if (verbose) console.error(`[input-server] invite token issued: ${inviteToken}`);
        logEv('invite-p2-issued', { host: hostUsername });
        return;
      }

      // ── Player 2 open join (no token) ────────────────────────────────────
      if (msg.type === 'join-p2-open') {
        if (!hostClient || hostClient.readyState !== hostClient.OPEN) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'no-host' }));
          logEv('p2-join-rejected', { reason: 'no-host', username: msg.username ?? 'player2' });
          return;
        }
        if (p2Client && p2Client.readyState === p2Client.OPEN) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'slot-taken' }));
          logEv('p2-join-rejected', { reason: 'slot-taken', username: msg.username ?? 'player2' });
          return;
        }
        if (ws === hostClient) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'already-host' }));
          return;
        }
        p2Client    = ws;
        p2Username  = msg.username ?? 'player2';
        inviteToken = null;
        ws.send(JSON.stringify({
          type: 'join-p2-confirmed', username: p2Username, joystickPort: p2Port(),
        }));
        broadcastExcept(ws, { type: 'player2-joined', username: p2Username, joystickPort: p2Port() });
        // Notify all clients that the slot is now taken
        broadcastAll({ type: 'p2-slot-status', open: false });
        if (verbose) console.error(`[input-server] player2 open-joined: ${p2Username}`);
        logEv('p2-joined', { username: p2Username, joystickPort: p2Port(), method: 'open' });
        resetP2Timeout();
        return;
      }

      // ── Player 2 join (invite token) ──────────────────────────────────────
      if (msg.type === 'join-p2') {
        if (!inviteToken || msg.token !== inviteToken) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'invalid-token' }));
          logEv('p2-join-rejected', { reason: 'invalid-token', username: msg.username ?? 'player2' });
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
        logEv('p2-joined', { username: p2Username, joystickPort: p2Port(), method: 'token' });
        resetP2Timeout();
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
        clearP2Timeout();
        p2Client      = null;
        p2Username    = null;
        if (leaving) broadcastAll({ type: 'player2-left', username: leaving });
        broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
        if (verbose) console.error(`[input-server] p2 revoked by host`);
        logEv('p2-kicked', { username: leaving ?? '?', by: 'host' });
        return;
      }

      // ── Admin kick ────────────────────────────────────────────────────────
      if (msg.type === 'admin-kick') {
        const valid = validateKickToken(msg.token ?? '');
        if (!valid) {
          ws.send(JSON.stringify({ type: 'admin-kick-error', reason: 'invalid-token' }));
          if (verbose) console.error('[input-server] admin-kick rejected: invalid token');
          logEv('error', { kind: 'admin-kick-invalid-token' });
          return;
        }
        const target = valid.target;
        if (target === 'host' && hostClient) {
          if (verbose) console.error(`[input-server] admin kicked host ${hostUsername}`);
          logEv('host-kicked', { username: hostUsername, by: 'admin' });
          clearHostTimeout();
          clearGrace();
          if (hostClient.readyState === hostClient.OPEN) {
            hostClient.send(JSON.stringify({ type: 'host-kicked', reason: 'admin' }));
          }
          const leaving = hostUsername;
          hostClient    = null;
          hostUsername  = null;
          inviteToken   = null;
          broadcastAll({ type: 'host-left', username: leaving, reason: 'admin-kick' });
          broadcastAll({ type: 'p2-slot-status', open: false });
        } else if (target === 'p2' && p2Client) {
          if (verbose) console.error(`[input-server] admin kicked player2 ${p2Username}`);
          logEv('p2-kicked', { username: p2Username, by: 'admin' });
          if (p2Client.readyState === p2Client.OPEN) {
            p2Client.send(JSON.stringify({ type: 'kicked', reason: 'admin' }));
          }
          const leaving = p2Username;
          clearP2Timeout();
          p2Client      = null;
          p2Username    = null;
          broadcastAll({ type: 'player2-left', username: leaving });
        } else {
          ws.send(JSON.stringify({ type: 'admin-kick-error', reason: 'target-not-present' }));
          logEv('error', { kind: 'admin-kick-target-missing', target });
        }
        return;
      }

      // ── Emulator commands (host only) ─────────────────────────────────────
      if (msg.type === 'load-crt') {
        if (ws !== hostClient) return;
        if (verbose) console.error(`[input-server] load-crt: ${msg.filename ?? '?'}`);
        logEv('cmd-load-crt', { filename: msg.filename ?? '?', dataLen: (msg.data ?? '').length });
        const loadFilename = msg.filename ?? '';
        broadcastAll({ type: 'cart-loading', filename: loadFilename });
        Promise.resolve()
          .then(() => onCommand({ type: 'load-crt', filename: loadFilename, data: msg.data ?? '' }))
          .then(() => {
            currentCartFilename = loadFilename || null;
            broadcastAll({ type: 'cart-loaded', filename: loadFilename });
          })
          .catch((e) => {
            broadcastAll({ type: 'cart-load-error', reason: String(e?.message ?? e) });
            if (verbose) console.error('[input-server] load-crt error:', e);
            logEv('error', { kind: 'load-crt-failed', filename: loadFilename, err: String(e?.message ?? e) });
          });
        return;
      }

      if (msg.type === 'detach-crt') {
        if (ws !== hostClient) return;
        if (verbose) console.error('[input-server] detach-crt');
        logEv('cmd-detach-crt', {});
        Promise.resolve()
          .then(() => onCommand({ type: 'detach-crt' }))
          .then(() => {
            currentCartFilename = null;
            broadcastAll({ type: 'cart-detached' });
          })
          .catch((e) => {
            if (verbose) console.error('[input-server] detach-crt error:', e);
            logEv('error', { kind: 'detach-crt-failed', err: String(e?.message ?? e) });
          });
        return;
      }

      if (msg.type === 'hard-reset') {
        if (ws !== hostClient) return;
        if (verbose) console.error('[input-server] hard-reset');
        logEv('cmd-hard-reset', { host: hostUsername });
        Promise.resolve()
          .then(() => onCommand({ type: 'hard-reset' }))
          .then(() => {
            broadcastAll({ type: 'machine-reset' });
          })
          .catch((e) => {
            if (verbose) console.error('[input-server] hard-reset error:', e);
            logEv('error', { kind: 'hard-reset-failed', err: String(e?.message ?? e) });
          });
        return;
      }

      // ── Input events ─────────────────────────────────────────────────────
      if (msg.type === 'joystick' || msg.type === 'key') {
        if (ws !== hostClient && ws !== p2Client) return;
        if (ws === hostClient) resetHostTimeout();
        if (ws === p2Client)   resetP2Timeout();
        // Track input counts for flood investigation
        const role = ws === hostClient ? 'host' : 'p2';
        const stats = role === 'host' ? _inputStats.host : _inputStats.p2;
        if (msg.type === 'joystick') stats.joystick++;
        else stats.key++;
        stats.lastMsgTime = Date.now();

        // ── Input latency profiling ───────────────────────────────────────
        if (msg.clientTime) {
          const now = Date.now();
          const latency = now - msg.clientTime;
          const bucket = _networkStats[role];
          if (bucket) {
            bucket.lastLatency = latency;
          }
          // Log latency periodically (every 5s) to avoid spam
          if (!_latencyLogTimer) {
            _latencyLogTimer = setInterval(() => {
              const hostActive = _latencyCount.host > 0;
              const p2Active   = _latencyCount.p2 > 0;
              if (hostActive || p2Active) {
                const hostAvg = hostActive ? Number(_avgLatency.host.toFixed(0)) : null;
                const p2Avg   = p2Active   ? Number(_avgLatency.p2.toFixed(0))   : null;
                const hostLabel = hostAvg != null ? `${hostAvg}` : '--';
                const p2Label   = p2Avg   != null ? `${p2Avg}`   : '--';
                console.error(`[input-latency] host-avg=${hostLabel}ms p2-avg=${p2Label}ms`);
                _networkStats.host.avgLatency = hostAvg;
                _networkStats.p2.avgLatency   = p2Avg;
                broadcastNetworkStats();
              }
              // Reset averages
              _avgLatency.host = 0; _avgLatency.p2 = 0;
              _latencyCount.host = 0; _latencyCount.p2 = 0;
            }, 5000);
          }
          // Accumulate for averaging
          _latencyCount[role]++;
          _avgLatency[role] = ((_avgLatency[role] * (_latencyCount[role] - 1)) + latency) / _latencyCount[role];
          if (latency > LATENCY_SPIKE_MS) {
            if (bucket) {
              bucket.lastSpikeLatency = latency;
              bucket.lastSpikeAt = now;
            }
            console.error(`[input-latency] spike role=${role} latency=${latency}ms type=${msg.type} action=${msg.action ?? '-'} ` +
              `dir=${msg.direction ?? '-'} fire=${msg.fire ? 1 : 0}`);
            }
        }

        // Tag with role so onInput can include it in logEvents output
        // without input-server needing to know about logEvents details.
        msg._role = role;
        if (onInput) onInput(msg);
        return;
      }

      if (msg.type === 'ping') {
        const role = ws === hostClient ? 'host' : (ws === p2Client ? 'p2' : 'spectator');
        const now = Date.now();
        const payload = {
          type: 'pong',
          pingId: msg.pingId ?? null,
          serverTime: now,
          clientTime: msg.clientTime ?? null,
        };
        try { ws.send(JSON.stringify(payload)); } catch (_) {}
        if (verbose) console.error(`[ping] role=${role} pong pingId=${msg.pingId ?? '-'} `);
        return;
      }
    });

    ws.on('close', () => {
      clientCount--;
      if (verbose) console.error(`[input-server] client disconnected (${clientCount} remaining)`);
      logEv('client-disconnected', { total: clientCount });

      if (ws === hostClient) {
        clearHostTimeout();
        hostClient   = null;
        const leaving = hostUsername;
        hostUsername  = null;
        inviteToken   = null;
        portsSwapped  = false;
        onHostDisconnect(leaving);
      }

      if (ws === p2Client) {
        clearP2Timeout();
        p2Client     = null;
        const leaving = p2Username;
        p2Username    = null;
        if (verbose) console.error(`[input-server] player2 ${leaving} disconnected`);
        logEv('p2-disconnected', { username: leaving, total: clientCount });
        broadcastExcept(ws, { type: 'player2-left', username: leaving });
        broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
      }
    });

    ws.on('error', (err) => {
      console.error(`[input-server] ws error:`, err.message);
      logEv('error', { kind: 'ws-error', err: err.message });
    });

    // ── Hello handshake ───────────────────────────────────────────────────
    const hostActive = !!(hostClient && hostClient.readyState === hostClient.OPEN);
    const serverTime = Date.now();
    ws.send(JSON.stringify({
      type:        'hello',
      protocol:    'c64-input',
      version:     1,
      serverTime,  // Unix ms for client clock sync
      // During grace period: treat slot as free so the original host can reclaim it.
      // hostPendingRejoin tells P2 (and spectators) to hold off.
      hostTaken:           hostActive,
      hostPendingRejoin:   !hostActive && !!graceTimer ? { username: pendingHostUsername, graceMs: HOST_RECONNECT_GRACE } : null,
      host:        hostActive ? { username: hostUsername, joystickPort: hostPort() } : null,
      player2:     p2Username ? { username: p2Username, joystickPort: p2Port() } : null,
      p2SlotOpen:  isP2SlotOpen(),
      ...(currentCartFilename ? { cartFilename: currentCartFilename } : {}),
      joystickBitmask: { up: 0x1, down: 0x2, left: 0x4, right: 0x8, fire: 0x10 },
      ...(serverVersion  ? { serverVersion }  : {}),
      ...(serverGitHash  ? { serverGitHash }  : {}),
    }));
  });

  wss.on('error', (err) => {
    console.error(`[input-server] server error:`, err.message);
    logEv('error', { kind: 'server-error', err: err.message });
  });

  const close = () => new Promise((resolve) => {
    clearHostTimeout();
    clearP2Timeout();
    clearGrace();
    wss.close(() => resolve());
  });

  return { wss, close };
}
