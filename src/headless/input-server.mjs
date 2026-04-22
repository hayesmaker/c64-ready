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
 *                                     { type: 'load-crt'|'detach-crt'|'hard-reset'|'reboot', ... }
 * @param {boolean}  [opts.verbose]
 * @param {number}   [opts.hostTimeoutMs=300000]
 * @param {Function} [opts.validateKickToken]
 * @param {Function} [opts.validateAdminToken]
 * @param {number}   [opts.hostReconnectGraceMs=8000]
 * @param {number}   [opts.p2ReconnectGraceMs=5000]
 * @param {Function} [opts.getRuntimeStats]
 * @param {Function} [opts.getWebrtcPeerSnapshot]
 * @param {Function} [opts.disconnectWebrtcPeersByAddr]
 * @param {Function} [opts.disconnectAllWebrtcPeers]
 * @param {string}   [opts.serverVersion]   Package version string, e.g. '0.7.0'
 * @param {string}   [opts.serverGitHash]   Abbreviated git commit hash, e.g. '16e86cd'
 * @returns {{ wss: WebSocketServer, close: () => Promise<void> }}
 */
export function createInputServer(opts = {}) {
  const port = opts.port ?? 9001;
  const onInput = opts.onInput;
  const onCommand = opts.onCommand ?? (() => {});
  const verbose = opts.verbose ?? false;
  const logEvents = opts.logEvents ?? false;
  const HOST_TIMEOUT = opts.hostTimeoutMs ?? 10 * 60 * 1000;
  const validateKickToken = opts.validateKickToken ?? (() => null);
  const validateAdminToken = opts.validateAdminToken ?? (() => false);
  const serverVersion = opts.serverVersion ?? null;
  const serverGitHash = opts.serverGitHash ?? null;
  const getRuntimeStats = opts.getRuntimeStats ?? (() => null);
  const getWebrtcPeerSnapshot = opts.getWebrtcPeerSnapshot ?? (() => null);
  const disconnectWebrtcPeersByAddr = opts.disconnectWebrtcPeersByAddr ?? (() => 0);
  const disconnectAllWebrtcPeers = opts.disconnectAllWebrtcPeers ?? (() => 0);

  // ── Input flood instrumentation ───────────────────────────────────────────────
  const _inputStats = {
    host: { joystick: 0, key: 0, lastMsgTime: 0 },
    p2: { joystick: 0, key: 0, lastMsgTime: 0 },
  };
  // ── Input latency tracking ─────────────────────────────────────────────────
  const LATENCY_SPIKE_MS = 200;
  const _latencyCount = { host: 0, p2: 0 };
  const _avgLatency = { host: 0, p2: 0 };
  let _latencyLogTimer = null;
  let _inputLogTimer = null;
  let _networkStatsTimer = null;
  const _networkStats = {
    host: { avgLatency: null, lastLatency: null, lastSpikeLatency: null, lastSpikeAt: null },
    p2: { avgLatency: null, lastLatency: null, lastSpikeLatency: null, lastSpikeAt: null },
  };

  function broadcastNetworkStats() {
    if (!hostClient && !p2Client) return;
    const runtime = getRuntimeStats?.() ?? null;
    const payload = JSON.stringify({
      type: 'network-stats',
      serverTime: Date.now(),
      host: { ..._networkStats.host },
      p2: { ..._networkStats.p2 },
      ...(runtime ? { server: runtime } : {}),
    });
    if (hostClient && hostClient.readyState === hostClient.OPEN) {
      try {
        hostClient.send(payload);
      } catch (_) {}
    }
    if (p2Client && p2Client.readyState === p2Client.OPEN) {
      try {
        p2Client.send(payload);
      } catch (_) {}
    }
  }
  const INPUT_LOG_INTERVAL_MS = 5000; // every 5 seconds

  function _startInputLog() {
    if (_inputLogTimer) return;
    _inputLogTimer = setInterval(() => {
      const now = Date.now();
      // Only log if there's been recent activity (within last 10s)
      const h = _inputStats.host.lastMsgTime && now - _inputStats.host.lastMsgTime < 10000;
      const p = _inputStats.p2.lastMsgTime && now - _inputStats.p2.lastMsgTime < 10000;
      if ((h || p) && (logEvents || verbose)) {
        console.error(
          `[event] input-flood host-joystick=${_inputStats.host.joystick} host-key=${_inputStats.host.key} p2-joystick=${_inputStats.p2.joystick} p2-key=${_inputStats.p2.key}`,
        );
      }
      // Reset counters after reporting
      _inputStats.host.joystick = 0;
      _inputStats.host.key = 0;
      _inputStats.p2.joystick = 0;
      _inputStats.p2.key = 0;
    }, INPUT_LOG_INTERVAL_MS);
  }

  function _startNetworkStatsTicker() {
    if (_networkStatsTimer) return;
    _networkStatsTimer = setInterval(() => {
      broadcastNetworkStats();
    }, 5000);
  }

  /** Emit a structured event log line — only when --log-events is active.
   *  Format: [event] <tag> key=value ...
   *  Never called per-frame; only on meaningful state transitions. */
  function logEv(tag, fields = {}) {
    if (!logEvents) return;
    const ts = new Date().toISOString();
    const pairs = Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.error(`[event] ${ts} ${tag}${pairs ? ' ' + pairs : ''}`);
  }

  const wss = new WebSocketServer({ port });
  const HOST_RECONNECT_GRACE = opts.hostReconnectGraceMs ?? 8_000;
  const P2_RECONNECT_GRACE = opts.p2ReconnectGraceMs ?? HOST_RECONNECT_GRACE;

  // ── Room state ────────────────────────────────────────────────────────────
  let hostClient = null;
  let hostUsername = null;

  let p2Client = null;
  let p2Username = null;
  let inviteToken = null;

  // Joystick port swap — when true, host uses port 1, P2 uses port 2
  let portsSwapped = false;
  // Optional host-defined override for independent per-role joystick ports.
  let portOverrideEnabled = false;
  let overrideHostPort = 2;
  let overrideP2Port = 1;

  // ── Host reconnect grace period ───────────────────────────────────────────
  // When the host disconnects we hold off on promoting P2 for up to
  // HOST_RECONNECT_GRACE ms, giving the host a chance to refresh and reclaim.
  let graceTimer = null;
  let pendingHostUsername = null; // username of the disconnected host
  let p2GraceTimer = null;
  let pendingP2Username = null;
  // Currently loaded cartridge filename (for hello message to late joiners).
  // Seeded from opts.initialCartFilename when a default game is pre-loaded.
  let currentCartFilename = opts.initialCartFilename ?? null;

  function hostPort() {
    return portOverrideEnabled ? overrideHostPort : portsSwapped ? 1 : 2;
  }
  function p2Port() {
    return portOverrideEnabled ? overrideP2Port : portsSwapped ? 2 : 1;
  }

  // ── Host inactivity timeout ───────────────────────────────────────────────
  let hostTimeoutTimer = null;

  function resetHostTimeout() {
    if (!hostClient) return;
    if (hostTimeoutTimer) clearTimeout(hostTimeoutTimer);
    hostTimeoutTimer = setTimeout(() => kickHostForInactivity(), HOST_TIMEOUT);
  }

  function clearHostTimeout() {
    if (hostTimeoutTimer) {
      clearTimeout(hostTimeoutTimer);
      hostTimeoutTimer = null;
    }
  }

  // ── P2 inactivity timeout ─────────────────────────────────────────────────
  let p2TimeoutTimer = null;

  function resetP2Timeout() {
    if (!p2Client) return;
    if (p2TimeoutTimer) clearTimeout(p2TimeoutTimer);
    p2TimeoutTimer = setTimeout(() => kickP2ForInactivity(), HOST_TIMEOUT);
  }

  function clearP2Timeout() {
    if (p2TimeoutTimer) {
      clearTimeout(p2TimeoutTimer);
      p2TimeoutTimer = null;
    }
  }

  function kickP2ForInactivity() {
    if (!p2Client) return;
    if (verbose) console.error(`[input-server] p2 ${p2Username} timed out due to inactivity`);
    logEv('p2-timeout', { username: p2Username });
    if (p2Client.readyState === p2Client.OPEN) {
      p2Client.send(JSON.stringify({ type: 'p2-timeout-kick', username: p2Username }));
    }
    const leaving = p2Username;
    setWsIdentity(p2Client, 'spectator', null);
    p2Client = null;
    p2Username = null;
    clearP2Grace();
    clearP2Timeout();
    broadcastAll({ type: 'player2-left', username: leaving, reason: 'timeout' });
    broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
  }

  // ── Host reconnect grace period helpers ───────────────────────────────────
  function clearGrace() {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    pendingHostUsername = null;
  }

  function clearP2Grace() {
    if (p2GraceTimer) {
      clearTimeout(p2GraceTimer);
      p2GraceTimer = null;
    }
    pendingP2Username = null;
  }

  // Called when grace expires without the host reconnecting.
  function expireGrace() {
    graceTimer = null;
    const leaving = pendingHostUsername;
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
    if (verbose)
      console.error(
        `[input-server] host ${leaving} disconnected — grace ${HOST_RECONNECT_GRACE}ms`,
      );
    logEv('host-disconnected', { username: leaving, graceMs: HOST_RECONNECT_GRACE });
    // Tell everyone the host is temporarily gone; P2 should wait before acting.
    broadcastAll({ type: 'host-disconnected', username: leaving, graceMs: HOST_RECONNECT_GRACE });
    graceTimer = setTimeout(expireGrace, HOST_RECONNECT_GRACE);
  }

  function expireP2Grace() {
    p2GraceTimer = null;
    const leaving = pendingP2Username;
    pendingP2Username = null;
    if (verbose) console.error(`[input-server] p2 grace expired for ${leaving}`);
    logEv('p2-grace-expired', { username: leaving });
    broadcastAll({ type: 'player2-left', username: leaving, reason: 'disconnect' });
    broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
  }

  function onP2Disconnect(leaving) {
    clearP2Grace();
    pendingP2Username = leaving;
    if (verbose)
      console.error(
        `[input-server] player2 ${leaving} disconnected — grace ${P2_RECONNECT_GRACE}ms`,
      );
    logEv('p2-disconnected', { username: leaving, graceMs: P2_RECONNECT_GRACE });
    p2GraceTimer = setTimeout(expireP2Grace, P2_RECONNECT_GRACE);
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
    setWsIdentity(hostClient, 'spectator', null);
    hostClient = null;
    hostUsername = null;
    inviteToken = null;
    portOverrideEnabled = false;
    overrideHostPort = 2;
    overrideP2Port = 1;
    clearHostTimeout();
    clearGrace();
    // Broadcast host-left with reason so clients can show a contextual notice
    broadcastAll({ type: 'host-left', username: leaving, reason: 'timeout' });
    broadcastAll({ type: 'p2-slot-status', open: false });
  }

  function kickHostByReason(reason = 'admin-kick') {
    if (!hostClient) return { kicked: false, username: null, addr: null };
    const targetWs = hostClient;
    const targetMeta = clientMeta.get(targetWs);
    const addr = targetMeta?.addr ?? null;
    const leaving = hostUsername;
    clearHostTimeout();
    clearGrace();
    if (targetWs.readyState === targetWs.OPEN) {
      try {
        targetWs.send(JSON.stringify({ type: 'host-kicked', reason }));
      } catch (_) {}
    }
    hostClient = null;
    hostUsername = null;
    inviteToken = null;
    portsSwapped = false;
    portOverrideEnabled = false;
    overrideHostPort = 2;
    overrideP2Port = 1;
    setWsIdentity(targetWs, 'spectator', null);
    broadcastAll({ type: 'host-left', username: leaving, reason });
    broadcastAll({ type: 'p2-slot-status', open: false });
    if (addr) disconnectWebrtcPeersByAddr(addr, reason);
    return { kicked: true, username: leaving, addr };
  }

  function kickP2ByReason(reason = 'admin-kick') {
    if (!p2Client) return { kicked: false, username: null, addr: null };
    const targetWs = p2Client;
    const targetMeta = clientMeta.get(targetWs);
    const addr = targetMeta?.addr ?? null;
    const leaving = p2Username;
    if (targetWs.readyState === targetWs.OPEN) {
      try {
        targetWs.send(JSON.stringify({ type: 'kicked', reason }));
      } catch (_) {}
    }
    clearP2Timeout();
    clearP2Grace();
    p2Client = null;
    p2Username = null;
    setWsIdentity(targetWs, 'spectator', null);
    broadcastAll({ type: 'player2-left', username: leaving, reason });
    broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
    if (addr) disconnectWebrtcPeersByAddr(addr, reason);
    return { kicked: true, username: leaving, addr };
  }

  function broadcastExcept(excludeWs, msg) {
    const raw = JSON.stringify(msg);
    wss.clients.forEach((c) => {
      if (c !== excludeWs && c.readyState === c.OPEN) c.send(raw);
    });
  }

  function broadcastAll(msg) {
    const raw = JSON.stringify(msg);
    wss.clients.forEach((c) => {
      if (c.readyState === c.OPEN) c.send(raw);
    });
  }

  // True when the P2 slot is available for open joining
  function isP2SlotOpen() {
    return (
      !!(hostClient && hostClient.readyState === hostClient.OPEN) &&
      !(p2Client && p2Client.readyState === p2Client.OPEN) &&
      !p2GraceTimer
    );
  }

  let clientCount = 0;
  const clientMeta = new Map(); // Map<WebSocket, { addr: string, role: string, username: string|null, sessionId: string|null }>

  function normalizeSessionId(value) {
    const raw = String(value ?? '').trim();
    return raw || null;
  }

  function normalizeUsername(value) {
    const username = String(value ?? '').trim().toLowerCase();
    return username || null;
  }

  function normalizeAddr(addr) {
    if (!addr) return '';
    return String(addr).replace(/^::ffff:/, '');
  }

  function setWsIdentity(ws, role, username = null) {
    const meta = clientMeta.get(ws);
    if (!meta) return;
    meta.role = role;
    meta.username = username;
  }

  function getRoleByPeer({ addr = null, sessionId = null } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const hostMeta = hostClient ? clientMeta.get(hostClient) : null;
    const p2Meta = p2Client ? clientMeta.get(p2Client) : null;

    if (normalizedSessionId) {
      if (hostMeta?.sessionId && hostMeta.sessionId === normalizedSessionId) {
        return { role: 'host', username: hostUsername, ws: hostClient };
      }
      if (p2Meta?.sessionId && p2Meta.sessionId === normalizedSessionId) {
        return { role: 'p2', username: p2Username, ws: p2Client };
      }
      return null;
    }

    const normalizedAddr = normalizeAddr(addr);
    if (!normalizedAddr) return null;
    const hostMatches = !!(hostMeta?.addr && hostMeta.addr === normalizedAddr);
    const p2Matches = !!(p2Meta?.addr && p2Meta.addr === normalizedAddr);
    if (hostMatches && !p2Matches) return { role: 'host', username: hostUsername, ws: hostClient };
    if (p2Matches && !hostMatches) return { role: 'p2', username: p2Username, ws: p2Client };
    return null;
  }

  function handleInputTransportMessage({ msg, role, respond = null } = {}) {
    if (!msg || (msg.type !== 'joystick' && msg.type !== 'key' && msg.type !== 'ping')) return false;

    if (msg.type === 'ping') {
      const now = Date.now();
      const payload = {
        type: 'pong',
        pingId: msg.pingId ?? null,
        serverTime: now,
        clientTime: msg.clientTime ?? null,
      };
      try {
        respond?.(payload);
      } catch (_) {}
      if (verbose) console.error(`[ping] role=${role} pong pingId=${msg.pingId ?? '-'} `);
      return true;
    }

    if (role === 'host') resetHostTimeout();
    if (role === 'p2') resetP2Timeout();

    const stats = role === 'host' ? _inputStats.host : _inputStats.p2;
    if (msg.type === 'joystick') stats.joystick++;
    else stats.key++;
    stats.lastMsgTime = Date.now();

    if (msg.clientTime) {
      const now = Date.now();
      const latency = now - msg.clientTime;
      const bucket = _networkStats[role];
      if (bucket) {
        bucket.lastLatency = latency;
      }
      if (!_latencyLogTimer) {
        _latencyLogTimer = setInterval(() => {
          const hostActive = _latencyCount.host > 0;
          const p2Active = _latencyCount.p2 > 0;
          if (hostActive || p2Active) {
            const hostAvg = hostActive ? Number(_avgLatency.host.toFixed(0)) : null;
            const p2Avg = p2Active ? Number(_avgLatency.p2.toFixed(0)) : null;
            const hostLabel = hostAvg != null ? `${hostAvg}` : '--';
            const p2Label = p2Avg != null ? `${p2Avg}` : '--';
            if (logEvents || verbose) {
              console.error(
                `[event] input-latency host-avg=${hostLabel}ms p2-avg=${p2Label}ms`,
              );
            }
            _networkStats.host.avgLatency = hostAvg;
            _networkStats.p2.avgLatency = p2Avg;
            broadcastNetworkStats();
          }
          _avgLatency.host = 0;
          _avgLatency.p2 = 0;
          _latencyCount.host = 0;
          _latencyCount.p2 = 0;
        }, 5000);
      }
      _latencyCount[role]++;
      _avgLatency[role] =
        (_avgLatency[role] * (_latencyCount[role] - 1) + latency) / _latencyCount[role];
      if (latency > LATENCY_SPIKE_MS) {
        if (bucket) {
          bucket.lastSpikeLatency = latency;
          bucket.lastSpikeAt = now;
        }
        if (logEvents || verbose) {
          console.error(
            `[event] input-latency-spike role=${role} latency=${latency}ms type=${msg.type} action=${msg.action ?? '-'} ` +
              `dir=${msg.direction ?? '-'} fire=${msg.fire ? 1 : 0}`,
          );
        }
      }
    }

    msg._role = role;
    if (msg.type === 'joystick') {
      msg.joystickPort = role === 'host' ? hostPort() : p2Port();
    }
    if (onInput) onInput(msg);
    if (Number.isFinite(msg.inputId)) {
      try {
        respond?.({ type: 'input-ack', inputId: msg.inputId });
      } catch (_) {}
    }
    return true;
  }

  function resetRoleActivity(role, source = 'unknown') {
    if (role === 'host') resetHostTimeout();
    else if (role === 'p2') resetP2Timeout();
    else return false;
    if (verbose) console.error(`[input-server] activity role=${role} source=${source}`);
    logEv('activity', { role, source });
    return true;
  }

  function handlePeerDataMessage({ addr = null, sessionId = null, msg, send = null } = {}) {
    const identity = getRoleByPeer({ addr, sessionId });
    if (!identity || (identity.role !== 'host' && identity.role !== 'p2')) return false;
    return handleInputTransportMessage({ msg, role: identity.role, respond: send, isWebSocket: false, ws: identity.ws });
  }

  function getWebrtcPeerCountByAddr() {
    const snapshot = getWebrtcPeerSnapshot?.() ?? null;
    const peers = Array.isArray(snapshot?.peers) ? snapshot.peers : [];
    const byAddr = new Map();
    const bySession = new Map();
    for (const p of peers) {
      const addr = normalizeAddr(p?.addr);
      const session = normalizeSessionId(p?.session);
      if (!addr) continue;
      byAddr.set(addr, (byAddr.get(addr) ?? 0) + 1);
      if (session) bySession.set(session, (bySession.get(session) ?? 0) + 1);
    }
    return { snapshot, byAddr, bySession };
  }

  function getSpectatorIdentity(meta, ws) {
    const sessionId = normalizeSessionId(meta?.sessionId);
    if (sessionId) return `session:${sessionId}`;
    const username = normalizeUsername(meta?.username);
    if (username) return `user:${username}`;
    return `socket:${String(meta?.addr ?? 'unknown')}:${ws._socket?._handle?.fd ?? 'na'}`;
  }

  function buildAdminStatus() {
    const hostMeta = hostClient ? clientMeta.get(hostClient) : null;
    const p2Meta = p2Client ? clientMeta.get(p2Client) : null;
    const spectators = [];
    const { snapshot: webrtcSnapshot, byAddr: webrtcByAddr, bySession: webrtcBySession } = getWebrtcPeerCountByAddr();
    const matchedPeerSlots = new Set();
    const webrtcPeers = Array.isArray(webrtcSnapshot?.peers) ? webrtcSnapshot.peers : [];

    function matchWebrtcPeers(meta) {
      const sessionId = normalizeSessionId(meta?.sessionId);
      if (sessionId && webrtcBySession.has(sessionId)) {
        let matched = 0;
        webrtcPeers.forEach((peer, index) => {
          if (normalizeSessionId(peer?.session) !== sessionId) return;
          matchedPeerSlots.add(index);
          matched++;
        });
        return matched;
      }

      const addr = normalizeAddr(meta?.addr);
      if (!addr || !webrtcByAddr.has(addr)) return 0;
      let matched = 0;
      webrtcPeers.forEach((peer, index) => {
        if (normalizeAddr(peer?.addr) !== addr) return;
        matchedPeerSlots.add(index);
        matched++;
      });
      return matched;
    }

    const spectatorByIdentity = new Map();
    const hostWebrtcPeers = matchWebrtcPeers(hostMeta);
    const p2WebrtcPeers = matchWebrtcPeers(p2Meta);
    for (const [ws, meta] of clientMeta.entries()) {
      if (ws === hostClient || ws === p2Client) continue;
      if (ws.readyState !== ws.OPEN) continue;
      if (meta.role === 'admin') continue;
      const identity = getSpectatorIdentity(meta, ws);
      const existing = spectatorByIdentity.get(identity);
      const spectator = existing ?? {
        addr: meta.addr,
        role: meta.role ?? 'spectator',
        username: meta.username ?? null,
        webrtcPeers: 0,
      };
      spectator.addr = spectator.addr ?? meta.addr;
      spectator.username = spectator.username ?? meta.username ?? null;
      spectator.webrtcPeers = Math.max(spectator.webrtcPeers, matchWebrtcPeers(meta));
      spectatorByIdentity.set(identity, spectator);
    }

    spectators.push(...spectatorByIdentity.values());

    const webrtcTotal = Number.isFinite(webrtcSnapshot?.total) ? webrtcSnapshot.total : 0;
    const anonymousWebrtcPeers = Math.max(0, webrtcTotal - matchedPeerSlots.size);

    return {
      host: hostClient
        ? {
            connected: hostClient.readyState === hostClient.OPEN,
            username: hostUsername,
            addr: hostMeta?.addr ?? null,
            webrtcPeers: hostWebrtcPeers,
          }
        : null,
      p2: p2Client
        ? {
            connected: p2Client.readyState === p2Client.OPEN,
            username: p2Username,
            addr: p2Meta?.addr ?? null,
            webrtcPeers: p2WebrtcPeers,
          }
        : null,
      spectators,
      counts: {
        inputClients: clientCount,
        spectators: spectators.length,
        webrtcActive: Number.isFinite(webrtcSnapshot?.active) ? webrtcSnapshot.active : 0,
        webrtcPending: Number.isFinite(webrtcSnapshot?.pending) ? webrtcSnapshot.pending : 0,
        webrtcTotal,
        anonymousWebrtcPeers,
      },
      webrtc: webrtcSnapshot,
      runtime: getRuntimeStats?.() ?? null,
      sampledAt: Date.now(),
    };
  }

  wss.on('listening', () => {
    console.error(`[input-server] WebSocket listening on ws://0.0.0.0:${port}`);
    logEv('server-listening', { port });
    // Start input flood logging
    _startInputLog();
    _startNetworkStatsTicker();
  });

  wss.on('connection', (ws, req) => {
    clientCount++;
    const addr = req.socket.remoteAddress;
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const sessionId = normalizeSessionId(reqUrl.searchParams.get('sid'));
    clientMeta.set(ws, { addr: normalizeAddr(addr), role: 'spectator', username: null, sessionId });
    if (verbose)
      console.error(`[input-server] client connected from ${addr} (${clientCount} total)`);
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
          console.error(
            `[input-server] rx: load-crt filename=${msg.filename ?? '?'} dataLen=${(msg.data ?? '').length}`,
          );
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
            logEv('host-claim-rejected', {
              reason: 'slot-taken',
              username: msg.username ?? 'player',
            });
            return;
          }
          // Forcibly evict the existing host before granting the new claim.
          if (verbose) console.error(`[input-server] force host claim — evicting ${hostUsername}`);
          logEv('host-force-evicted', { evicted: hostUsername, by: msg.username ?? 'player' });
          clearHostTimeout();
          clearGrace();
          try {
            hostClient.send(JSON.stringify({ type: 'host-evicted', reason: 'force-claim' }));
          } catch (_) {}
          try {
            hostClient.close();
          } catch (_) {}
          setWsIdentity(hostClient, 'spectator', null);
          hostClient = null;
          hostUsername = null;
          inviteToken = null;
        }
        const isRejoin = graceTimer && pendingHostUsername === (msg.username ?? 'player');
        if (graceTimer) clearGrace(); // cancel grace regardless of who's claiming
        hostClient = ws;
        hostUsername = msg.username ?? 'player';
        setWsIdentity(ws, 'host', hostUsername);
        ws.send(
          JSON.stringify({
            type: 'host-confirmed',
            username: hostUsername,
            joystickPort: hostPort(),
            player2: p2Username ? { username: p2Username, joystickPort: p2Port() } : null,
          }),
        );
        if (isRejoin) {
          broadcastExcept(ws, {
            type: 'host-rejoined',
            username: hostUsername,
            joystickPort: hostPort(),
          });
        } else {
          broadcastExcept(ws, {
            type: 'host-joined',
            username: hostUsername,
            joystickPort: hostPort(),
          });
        }
        if (verbose)
          console.error(`[input-server] host ${isRejoin ? 're' : ''}claimed by ${hostUsername}`);
        logEv(isRejoin ? 'host-rejoined' : 'host-joined', {
          username: hostUsername,
          joystickPort: hostPort(),
        });
        resetHostTimeout();
        // P2 slot just opened (host present, no P2)
        broadcastExcept(ws, { type: 'p2-slot-status', open: isP2SlotOpen() });
        return;
      }

      // ── Swap joystick ports ───────────────────────────────────────────────
      if (msg.type === 'swap-ports') {
        if (ws !== hostClient) return;
        portsSwapped = !portsSwapped;
        if (verbose)
          console.error(`[input-server] ports swapped: host=${hostPort()} p2=${p2Port()}`);
        logEv('ports-swapped', { hostPort: hostPort(), p2Port: p2Port() });
        broadcastAll({
          type: 'ports-swapped',
          swapped: portsSwapped,
          hostPort: hostPort(),
          p2Port: p2Port(),
        });
        return;
      }

      // ── Host-defined independent joystick port override ───────────────────
      if (msg.type === 'set-port-override') {
        if (ws !== hostClient) return;
        const enabled = !!msg.enabled;
        const hp = Number(msg.hostPort);
        const pp = Number(msg.p2Port);
        if (
          !Number.isFinite(hp) ||
          !Number.isFinite(pp) ||
          (hp !== 1 && hp !== 2) ||
          (pp !== 1 && pp !== 2)
        ) {
          if (verbose) console.error('[input-server] invalid set-port-override payload');
          logEv('error', {
            kind: 'set-port-override-invalid',
            hostPort: msg.hostPort,
            p2Port: msg.p2Port,
          });
          return;
        }
        portOverrideEnabled = enabled;
        overrideHostPort = hp;
        overrideP2Port = pp;
        logEv('port-override-updated', {
          enabled: portOverrideEnabled,
          hostPort: overrideHostPort,
          p2Port: overrideP2Port,
          effectiveHostPort: hostPort(),
          effectiveP2Port: p2Port(),
        });
        broadcastAll({
          type: 'port-override-updated',
          enabled: portOverrideEnabled,
          hostPort: overrideHostPort,
          p2Port: overrideP2Port,
          effectiveHostPort: hostPort(),
          effectiveP2Port: p2Port(),
        });
        return;
      }
      // ── Voluntary player 2 leave ──────────────────────────────────────────
      if (msg.type === 'p2-leave') {
        if (ws === p2Client) {
          clearP2Timeout();
          p2Client = null;
          const leaving = p2Username;
          p2Username = null;
          setWsIdentity(ws, 'spectator', null);
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
          hostClient = null;
          const leaving = hostUsername;
          hostUsername = null;
          inviteToken = null;
          portsSwapped = false;
          portOverrideEnabled = false;
          overrideHostPort = 2;
          overrideP2Port = 1;
          setWsIdentity(ws, 'spectator', null);
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
        if ((p2Client && p2Client.readyState === p2Client.OPEN) || p2GraceTimer) {
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
        const requestedUsername = msg.username ?? 'player2';
        const isRejoin = !!p2GraceTimer && pendingP2Username === requestedUsername;
        if (p2GraceTimer && !isRejoin) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'slot-taken' }));
          logEv('p2-join-rejected', {
            reason: 'slot-pending-rejoin',
            username: requestedUsername,
            pending: pendingP2Username ?? '-',
          });
          return;
        }
        if (isRejoin) clearP2Grace();
        if (ws === hostClient) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'already-host' }));
          return;
        }
        p2Client = ws;
        p2Username = requestedUsername;
        inviteToken = null;
        setWsIdentity(ws, 'p2', p2Username);
        ws.send(
          JSON.stringify({
            type: 'join-p2-confirmed',
            username: p2Username,
            joystickPort: p2Port(),
          }),
        );
        broadcastExcept(ws, {
          type: 'player2-joined',
          username: p2Username,
          joystickPort: p2Port(),
        });
        // Notify all clients that the slot is now taken
        broadcastAll({ type: 'p2-slot-status', open: false });
        if (verbose) {
          console.error(
            `[input-server] player2 ${isRejoin ? 're' : ''}joined (open): ${p2Username}`,
          );
        }
        logEv(isRejoin ? 'p2-rejoined' : 'p2-joined', {
          username: p2Username,
          joystickPort: p2Port(),
          method: 'open',
        });
        resetP2Timeout();
        return;
      }

      // ── Player 2 join (invite token) ──────────────────────────────────────
      if (msg.type === 'join-p2') {
        if (!inviteToken || msg.token !== inviteToken) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'invalid-token' }));
          logEv('p2-join-rejected', {
            reason: 'invalid-token',
            username: msg.username ?? 'player2',
          });
          return;
        }
        if (p2Client && p2Client.readyState === p2Client.OPEN) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'slot-taken' }));
          return;
        }
        const requestedUsername = msg.username ?? 'player2';
        const isRejoin = !!p2GraceTimer && pendingP2Username === requestedUsername;
        if (p2GraceTimer && !isRejoin) {
          ws.send(JSON.stringify({ type: 'join-p2-error', reason: 'slot-taken' }));
          logEv('p2-join-rejected', {
            reason: 'slot-pending-rejoin',
            username: requestedUsername,
            pending: pendingP2Username ?? '-',
          });
          return;
        }
        if (isRejoin) clearP2Grace();
        p2Client = ws;
        p2Username = requestedUsername;
        inviteToken = null;
        setWsIdentity(ws, 'p2', p2Username);
        ws.send(
          JSON.stringify({
            type: 'join-p2-confirmed',
            username: p2Username,
            joystickPort: p2Port(),
          }),
        );
        broadcastExcept(ws, {
          type: 'player2-joined',
          username: p2Username,
          joystickPort: p2Port(),
        });
        broadcastAll({ type: 'p2-slot-status', open: false });
        if (verbose) {
          console.error(
            `[input-server] player2 ${isRejoin ? 're' : ''}joined (token): ${p2Username}`,
          );
        }
        logEv(isRejoin ? 'p2-rejoined' : 'p2-joined', {
          username: p2Username,
          joystickPort: p2Port(),
          method: 'token',
        });
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
        const pendingLeaving = pendingP2Username;
        clearP2Timeout();
        clearP2Grace();
        p2Client = null;
        p2Username = null;
        setWsIdentity(ws, 'spectator', null);
        if (leaving || pendingLeaving) {
          broadcastAll({
            type: 'player2-left',
            username: leaving ?? pendingLeaving,
            reason: 'revoked',
          });
        }
        broadcastAll({ type: 'p2-slot-status', open: isP2SlotOpen() });
        if (verbose) console.error(`[input-server] p2 revoked by host`);
        logEv('p2-kicked', { username: leaving ?? '?', by: 'host' });
        return;
      }

      // ── Admin CLI commands (token-authenticated) ─────────────────────────
      if (msg.type === 'admin-status') {
        const valid = validateAdminToken(msg.token ?? '');
        if (!valid) {
          ws.send(
            JSON.stringify({ type: 'admin-error', command: 'status', reason: 'invalid-token' }),
          );
          return;
        }
        setWsIdentity(ws, 'admin', null);
        ws.send(
          JSON.stringify({
            type: 'admin-status-ok',
            status: buildAdminStatus(),
          }),
        );
        return;
      }

      if (msg.type === 'admin-kick-player') {
        const valid = validateAdminToken(msg.token ?? '');
        if (!valid) {
          ws.send(
            JSON.stringify({
              type: 'admin-error',
              command: 'kick-player',
              reason: 'invalid-token',
            }),
          );
          return;
        }
        setWsIdentity(ws, 'admin', null);
        const target = msg.target === 'p2' ? 'p2' : msg.target === 'host' ? 'host' : null;
        if (!target) {
          ws.send(
            JSON.stringify({
              type: 'admin-error',
              command: 'kick-player',
              reason: 'invalid-target',
            }),
          );
          return;
        }
        const result =
          target === 'host' ? kickHostByReason('admin-kick') : kickP2ByReason('admin-kick');
        if (!result.kicked) {
          ws.send(
            JSON.stringify({
              type: 'admin-error',
              command: 'kick-player',
              reason: 'target-not-present',
              target,
            }),
          );
          return;
        }
        logEv(target === 'host' ? 'host-kicked' : 'p2-kicked', {
          username: result.username ?? '-',
          by: 'admin-cli',
        });
        ws.send(
          JSON.stringify({
            type: 'admin-kick-player-ok',
            target,
            username: result.username,
            addr: result.addr,
            status: buildAdminStatus(),
          }),
        );
        return;
      }

      if (msg.type === 'admin-activity') {
        const valid = validateAdminToken(msg.token ?? '');
        if (!valid) {
          ws.send(
            JSON.stringify({ type: 'admin-error', command: 'activity', reason: 'invalid-token' }),
          );
          return;
        }
        setWsIdentity(ws, 'admin', null);
        const role = msg.role === 'p2' ? 'p2' : msg.role === 'host' ? 'host' : null;
        if (!role) {
          ws.send(
            JSON.stringify({ type: 'admin-error', command: 'activity', reason: 'invalid-role' }),
          );
          return;
        }
        const active = role === 'host' ? !!hostClient : !!p2Client;
        if (!active) {
          ws.send(
            JSON.stringify({ type: 'admin-error', command: 'activity', reason: 'role-not-present' }),
          );
          return;
        }
        resetRoleActivity(role, msg.source ?? 'admin');
        ws.send(
          JSON.stringify({
            type: 'admin-activity-ok',
            role,
            source: msg.source ?? 'admin',
          }),
        );
        return;
      }

      if (msg.type === 'admin-kick-all') {
        const valid = validateAdminToken(msg.token ?? '');
        if (!valid) {
          ws.send(
            JSON.stringify({ type: 'admin-error', command: 'kick-all', reason: 'invalid-token' }),
          );
          return;
        }
        setWsIdentity(ws, 'admin', null);
        const kicked = { host: null, p2: null, spectators: 0, webrtcPeers: 0 };
        const previousHostWs = hostClient;
        const previousP2Ws = p2Client;
        const hostResult = kickHostByReason('admin-kick-all');
        if (hostResult.kicked) kicked.host = hostResult.username;
        const p2Result = kickP2ByReason('admin-kick-all');
        if (p2Result.kicked) kicked.p2 = p2Result.username;

        for (const c of wss.clients) {
          if (c === ws) continue;
          if (c === previousHostWs || c === previousP2Ws) continue;
          const meta = clientMeta.get(c);
          if (meta?.role === 'admin') continue;
          try {
            if (c.readyState === c.OPEN)
              c.send(JSON.stringify({ type: 'kicked', reason: 'admin-kick-all' }));
            c.close();
            kicked.spectators++;
          } catch (_) {}
        }
        kicked.webrtcPeers = disconnectAllWebrtcPeers('admin-kick-all');
        logEv('admin-kick-all', { spectators: kicked.spectators, webrtcPeers: kicked.webrtcPeers });
        ws.send(
          JSON.stringify({
            type: 'admin-kick-all-ok',
            kicked,
            status: buildAdminStatus(),
          }),
        );
        return;
      }

      // ── Admin kick (legacy one-time token flow) ───────────────────────────
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
          const result = kickHostByReason('admin-kick');
          logEv('host-kicked', { username: result.username ?? '-', by: 'admin' });
        } else if (target === 'p2' && p2Client) {
          if (verbose) console.error(`[input-server] admin kicked player2 ${p2Username}`);
          const result = kickP2ByReason('admin-kick');
          logEv('p2-kicked', { username: result.username ?? '-', by: 'admin' });
        } else {
          ws.send(JSON.stringify({ type: 'admin-kick-error', reason: 'target-not-present' }));
          logEv('error', { kind: 'admin-kick-target-missing', target });
        }
        return;
      }

      // ── Emulator commands (host only) ─────────────────────────────────────
      if (msg.type === 'load-file') {
        if (ws !== hostClient) return;
        const loadFilename = msg.filename ?? '';
        const fileType = msg.fileType ?? 'crt';
        if (verbose)
          console.error(`[input-server] load-file: ${loadFilename || '?'} (${fileType})`);
        logEv('cmd-load-file', {
          filename: loadFilename || '?',
          fileType,
          dataLen: (msg.data ?? '').length,
        });
        broadcastAll({ type: 'cart-loading', filename: loadFilename });
        Promise.resolve()
          .then(() =>
            onCommand({
              type: 'load-file',
              filename: loadFilename,
              fileType,
              data: msg.data ?? '',
            }),
          )
          .then(() => {
            currentCartFilename = loadFilename || null;
            broadcastAll({ type: 'cart-loaded', filename: loadFilename });
          })
          .catch((e) => {
            broadcastAll({ type: 'cart-load-error', reason: String(e?.message ?? e) });
            if (verbose) console.error('[input-server] load-file error:', e);
            logEv('error', {
              kind: 'load-file-failed',
              filename: loadFilename,
              fileType,
              err: String(e?.message ?? e),
            });
          });
        return;
      }

      if (msg.type === 'load-crt') {
        if (ws !== hostClient) return;
        if (verbose) console.error(`[input-server] load-crt: ${msg.filename ?? '?'}`);
        logEv('cmd-load-crt', { filename: msg.filename ?? '?', dataLen: (msg.data ?? '').length });
        const loadFilename = msg.filename ?? '';
        broadcastAll({ type: 'cart-loading', filename: loadFilename });
        Promise.resolve()
          .then(() =>
            onCommand({
              type: 'load-file',
              filename: loadFilename,
              fileType: 'crt',
              data: msg.data ?? '',
            }),
          )
          .then(() => {
            currentCartFilename = loadFilename || null;
            broadcastAll({ type: 'cart-loaded', filename: loadFilename });
          })
          .catch((e) => {
            broadcastAll({ type: 'cart-load-error', reason: String(e?.message ?? e) });
            if (verbose) console.error('[input-server] load-crt error:', e);
            logEv('error', {
              kind: 'load-crt-failed',
              filename: loadFilename,
              err: String(e?.message ?? e),
            });
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

      if (msg.type === 'reboot') {
        if (ws !== hostClient) return;
        if (verbose) console.error('[input-server] reboot');
        logEv('cmd-reboot', { host: hostUsername });
        Promise.resolve()
          .then(() => onCommand({ type: 'reboot' }))
          .then(() => {
            currentCartFilename = null;
            broadcastAll({ type: 'machine-rebooted' });
          })
          .catch((e) => {
            if (verbose) console.error('[input-server] reboot error:', e);
            logEv('error', { kind: 'reboot-failed', err: String(e?.message ?? e) });
          });
        return;
      }

      // ── Input events ─────────────────────────────────────────────────────
      if (msg.type === 'joystick' || msg.type === 'key') {
        if (ws !== hostClient && ws !== p2Client) return;
        const role = ws === hostClient ? 'host' : 'p2';
        handleInputTransportMessage({
          msg,
          role,
          respond: (payload) => {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
          },
        });
        return;
      }

      if (msg.type === 'ping') {
        const role = ws === hostClient ? 'host' : ws === p2Client ? 'p2' : 'spectator';
        handleInputTransportMessage({
          msg,
          role,
          respond: (payload) => {
            try {
              ws.send(JSON.stringify(payload));
            } catch (_) {}
          },
        });
        return;
      }
    });

    ws.on('close', () => {
      clientCount--;
      if (verbose) console.error(`[input-server] client disconnected (${clientCount} remaining)`);
      logEv('client-disconnected', { total: clientCount });

      if (ws === hostClient) {
        clearHostTimeout();
        hostClient = null;
        const leaving = hostUsername;
        hostUsername = null;
        inviteToken = null;
        portsSwapped = false;
        portOverrideEnabled = false;
        overrideHostPort = 2;
        overrideP2Port = 1;
        onHostDisconnect(leaving);
      }

      if (ws === p2Client) {
        clearP2Timeout();
        p2Client = null;
        const leaving = p2Username;
        p2Username = null;
        onP2Disconnect(leaving);
      }
      clientMeta.delete(ws);
    });

    ws.on('error', (err) => {
      console.error(`[input-server] ws error:`, err.message);
      logEv('error', { kind: 'ws-error', err: err.message });
    });

    // ── Hello handshake ───────────────────────────────────────────────────
    const hostActive = !!(hostClient && hostClient.readyState === hostClient.OPEN);
    const serverTime = Date.now();
    ws.send(
      JSON.stringify({
        type: 'hello',
        protocol: 'c64-input',
        version: 1,
        serverTime, // Unix ms for client clock sync
        // During grace period: treat slot as free so the original host can reclaim it.
        // hostPendingRejoin tells P2 (and spectators) to hold off.
        hostTaken: hostActive,
        hostPendingRejoin:
          !hostActive && !!graceTimer
            ? { username: pendingHostUsername, graceMs: HOST_RECONNECT_GRACE }
            : null,
        host: hostActive ? { username: hostUsername, joystickPort: hostPort() } : null,
        p2PendingRejoin:
          !p2Client && !!p2GraceTimer
            ? { username: pendingP2Username, graceMs: P2_RECONNECT_GRACE }
            : null,
        player2: p2Username ? { username: p2Username, joystickPort: p2Port() } : null,
        p2SlotOpen: isP2SlotOpen(),
        portOverride: {
          enabled: portOverrideEnabled,
          hostPort: overrideHostPort,
          p2Port: overrideP2Port,
          effectiveHostPort: hostPort(),
          effectiveP2Port: p2Port(),
        },
        ...(currentCartFilename ? { cartFilename: currentCartFilename } : {}),
        joystickBitmask: { up: 0x1, down: 0x2, left: 0x4, right: 0x8, fire: 0x10 },
        ...(serverVersion ? { serverVersion } : {}),
        ...(serverGitHash ? { serverGitHash } : {}),
      }),
    );
  });

  wss.on('error', (err) => {
    console.error(`[input-server] server error:`, err.message);
    logEv('error', { kind: 'server-error', err: err.message });
  });

  const close = () =>
    new Promise((resolve) => {
      clearHostTimeout();
      clearP2Timeout();
      clearGrace();
      clearP2Grace();
      if (_inputLogTimer) {
        clearInterval(_inputLogTimer);
        _inputLogTimer = null;
      }
      if (_latencyLogTimer) {
        clearInterval(_latencyLogTimer);
        _latencyLogTimer = null;
      }
      if (_networkStatsTimer) {
        clearInterval(_networkStatsTimer);
        _networkStatsTimer = null;
      }
      for (const client of wss.clients) {
        try { client.terminate(); } catch (_) {}
      }
      wss.close(() => resolve());
    });

  return { wss, close, handlePeerDataMessage };
}
