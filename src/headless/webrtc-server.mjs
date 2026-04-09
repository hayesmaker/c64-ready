/**
 * webrtc-server.mjs
 *
 * Lightweight WebRTC signalling server.
 *
 * HTTP GET /  → returns the self-contained browser player page (see BROWSER_HTML)
 * WebSocket upgrade → SDP offer/answer + trickle-ICE exchange
 *
 * Signalling flow:
 *   1. Browser connects via WebSocket
 *   2. Browser creates an RTCPeerConnection and sends an SDP offer
 *   3. Server receives the offer, calls onOffer(pc) so the caller can addTrack() BEFORE answer
 *   4. Server creates the SDP answer and sends it back
 *   5. Both sides exchange trickle ICE candidates
 *   6. onPeerConnected(pc) fires once ICE reaches 'connected' / 'completed'
 *
 * The caller (headless-cli.mjs) is responsible for:
 *   - Calling onOffer(pc) to attach MediaStreamTracks before answer is sent
 *   - Optionally reacting to onPeerConnected(pc) for per-connection bookkeeping
 */

import http from 'http';
import { WebSocketServer } from 'ws';
import wrtc from '@roamhq/wrtc';

const { RTCPeerConnection } = wrtc;

/**
 * @param {object}   opts
 * @param {number}   [opts.port=9002]          HTTP + WS listen port
 * @param {boolean}  [opts.verbose=false]       Log state changes to stderr
 * @param {number}   [opts.inputPort=9001]      Port the input WebSocket listens on
 *                                               (embedded in the browser page)
 * @param {number}   [opts.maxSpectators=3]     Maximum number of spectator connections
 *                                               (not counting the 2 player slots).
 *                                               When the limit is reached, new WebRTC
 *                                               connections are rejected immediately with
 *                                               a { type: 'capacity-full' } message.
 * @param {number}   [opts.minBitrateKbps=200]  SDP x-google-min-bitrate for VP8 answer
 * @param {number}   [opts.maxBitrateKbps=600]  SDP x-google-max-bitrate for VP8 answer
 * @param {(pc: RTCPeerConnection) => void} opts.onOffer
 *   Called synchronously when an SDP offer arrives, BEFORE createAnswer().
 *   Attach tracks here: pc.addTrack(videoTrack, stream)
 * @param {(pc: RTCPeerConnection) => void} [opts.onPeerConnected]
 *   Called once ICE reaches 'connected' or 'completed'.
 * @returns {{ close: () => Promise<void> }}
 */
export function createWebRTCServer({
  port = 9002,
  verbose = false,
  logEvents = false,
  inputPort = 9001,
  maxSpectators = 3,
  minBitrateKbps = 200,
  maxBitrateKbps = 600,
  onOffer,
  onPeerConnected,
} = {}) {
  /** Emit a structured [event] line — same format as input-server.mjs. */
  function logEv(tag, fields = {}) {
    if (!logEvents) return;
    const ts = new Date().toISOString();
    const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    console.error(`[event] ${ts} ${tag}${pairs ? ' ' + pairs : ''}`);
  }
  // Track all active peer connections so forceKeyframe() can reach them all.
  const activePeers = new Set();
  const peerControllers = new Set();
  const peerBySession = new Map();
  const peerStatsPrev = new Map();
  const senderTelemetry = {
    sampledAt: Date.now(),
    peerCount: 0,
    avgRttMs: null,
    sendDelayMsPerPacket: null,
    encodeMsPerFrame: null,
    framesSentPerSec: null,
    framesEncodedPerSec: null,
    bytesSentPerSec: null,
    qualityLimitation: null,
  };
  let lastPressureLogAt = 0;
  let lastPressureSignature = '';
  const minBitrateKbpsSafe = Number.isFinite(minBitrateKbps) && minBitrateKbps > 0
    ? Math.round(minBitrateKbps)
    : 200;
  const maxBitrateKbpsSafe = Number.isFinite(maxBitrateKbps) && maxBitrateKbps > 0
    ? Math.max(minBitrateKbpsSafe, Math.round(maxBitrateKbps))
    : Math.max(minBitrateKbpsSafe, 600);

  // Total capacity = 2 player slots + maxSpectators.
  // We track all in-flight WS connections (including those not yet ICE-connected)
  // so that a burst of simultaneous connects doesn't slip past the gate.
  const MAX_CONNECTIONS = 2 + maxSpectators;
  let pendingPeers = 0; // WS connections not yet ICE-connected or ICE-failed

  function logLoadSnapshot(tag, extra = {}) {
    const snapshot = {
      active: activePeers.size,
      pending: pendingPeers,
      total: activePeers.size + pendingPeers,
      max: MAX_CONNECTIONS,
      ...extra,
    };
    logEv(tag, snapshot);
    if (verbose) console.error(`[webrtc-load] ${tag} active=${snapshot.active} pending=${snapshot.pending} total=${snapshot.total}/${snapshot.max}`);
  }

  async function logRouteSnapshot(pc, remoteAddr) {
    try {
      const report = await pc.getStats();
      let selected = null;
      const localById = new Map();
      const remoteById = new Map();
      for (const stat of report.values()) {
        if (stat.type === 'candidate-pair' && stat.nominated && (stat.state === 'succeeded' || stat.selected)) selected = stat;
        if (stat.type === 'local-candidate') localById.set(stat.id, stat);
        if (stat.type === 'remote-candidate') remoteById.set(stat.id, stat);
      }
      if (!selected) return;
      const local = localById.get(selected.localCandidateId);
      const remote = remoteById.get(selected.remoteCandidateId);
      const rttMs = Number.isFinite(selected.currentRoundTripTime) ? Math.round(selected.currentRoundTripTime * 1000) : null;
      logEv('webrtc-route', {
        addr: remoteAddr,
        protocol: selected.protocol ?? '-',
        localType: local?.candidateType ?? '-',
        remoteType: remote?.candidateType ?? '-',
        networkType: local?.networkType ?? '-',
        rttMs: rttMs ?? '-',
      });
      if (verbose) {
        console.error(`[webrtc-route] addr=${remoteAddr} protocol=${selected.protocol ?? '-'} local=${local?.candidateType ?? '-'} remote=${remote?.candidateType ?? '-'} net=${local?.networkType ?? '-'} rtt=${rttMs ?? '-'}ms`);
      }
    } catch (_) {
      // Best-effort diagnostics only
    }
  }

  async function sampleSenderTelemetry() {
    const nowWall = Date.now();
    let peerCount = 0;
    let rttSum = 0;
    let rttCount = 0;
    let deltaFramesSent = 0;
    let deltaFramesEncoded = 0;
    let deltaBytesSent = 0;
    let deltaPacketsSent = 0;
    let deltaPacketSendDelay = 0;
    let deltaEncodeTime = 0;
    const qualityCounts = {};

    for (const pc of activePeers) {
      peerCount++;
      try {
        const report = await pc.getStats();
        let selected = null;
        let outboundVideo = null;
        for (const stat of report.values()) {
          if (stat.type === 'candidate-pair' && stat.nominated && (stat.state === 'succeeded' || stat.selected)) {
            selected = stat;
          }
          if (stat.type === 'outbound-rtp' && stat.kind === 'video' && !stat.isRemote) {
            outboundVideo = stat;
          }
        }

        if (selected && Number.isFinite(selected.currentRoundTripTime)) {
          rttSum += selected.currentRoundTripTime * 1000;
          rttCount++;
        }
        if (!outboundVideo) continue;

        const reason = outboundVideo.qualityLimitationReason ?? 'none';
        qualityCounts[reason] = (qualityCounts[reason] ?? 0) + 1;

        const current = {
          timestampMs: Number.isFinite(outboundVideo.timestamp) ? outboundVideo.timestamp : nowWall,
          framesSent: Number.isFinite(outboundVideo.framesSent) ? outboundVideo.framesSent : null,
          framesEncoded: Number.isFinite(outboundVideo.framesEncoded) ? outboundVideo.framesEncoded : null,
          bytesSent: Number.isFinite(outboundVideo.bytesSent) ? outboundVideo.bytesSent : null,
          packetsSent: Number.isFinite(outboundVideo.packetsSent) ? outboundVideo.packetsSent : null,
          totalPacketSendDelay: Number.isFinite(outboundVideo.totalPacketSendDelay) ? outboundVideo.totalPacketSendDelay : null,
          totalEncodeTime: Number.isFinite(outboundVideo.totalEncodeTime) ? outboundVideo.totalEncodeTime : null,
        };

        const prev = peerStatsPrev.get(pc);
        peerStatsPrev.set(pc, current);
        if (!prev) continue;

        if (current.framesSent != null && prev.framesSent != null && current.framesSent >= prev.framesSent) {
          deltaFramesSent += current.framesSent - prev.framesSent;
        }
        if (current.framesEncoded != null && prev.framesEncoded != null && current.framesEncoded >= prev.framesEncoded) {
          deltaFramesEncoded += current.framesEncoded - prev.framesEncoded;
        }
        if (current.bytesSent != null && prev.bytesSent != null && current.bytesSent >= prev.bytesSent) {
          deltaBytesSent += current.bytesSent - prev.bytesSent;
        }
        if (current.packetsSent != null && prev.packetsSent != null && current.packetsSent >= prev.packetsSent) {
          deltaPacketsSent += current.packetsSent - prev.packetsSent;
        }
        if (current.totalPacketSendDelay != null && prev.totalPacketSendDelay != null && current.totalPacketSendDelay >= prev.totalPacketSendDelay) {
          deltaPacketSendDelay += current.totalPacketSendDelay - prev.totalPacketSendDelay;
        }
        if (current.totalEncodeTime != null && prev.totalEncodeTime != null && current.totalEncodeTime >= prev.totalEncodeTime) {
          deltaEncodeTime += current.totalEncodeTime - prev.totalEncodeTime;
        }
      } catch (_) {
        // best effort only
      }
    }

    const sampleIntervalS = 5;
    senderTelemetry.sampledAt = nowWall;
    senderTelemetry.peerCount = peerCount;
    senderTelemetry.avgRttMs = rttCount > 0 ? (rttSum / rttCount) : null;
    senderTelemetry.sendDelayMsPerPacket = deltaPacketsSent > 0 ? (deltaPacketSendDelay / deltaPacketsSent) * 1000 : null;
    senderTelemetry.encodeMsPerFrame = deltaFramesEncoded > 0 ? (deltaEncodeTime / deltaFramesEncoded) * 1000 : null;
    senderTelemetry.framesSentPerSec = deltaFramesSent / sampleIntervalS;
    senderTelemetry.framesEncodedPerSec = deltaFramesEncoded / sampleIntervalS;
    senderTelemetry.bytesSentPerSec = deltaBytesSent / sampleIntervalS;
    senderTelemetry.qualityLimitation = qualityCounts;

    if (peerCount > 0) {
      const avgRttMs = Number.isFinite(senderTelemetry.avgRttMs)
        ? senderTelemetry.avgRttMs.toFixed(1)
        : '-';
      const encodeMs = Number.isFinite(senderTelemetry.encodeMsPerFrame)
        ? senderTelemetry.encodeMsPerFrame.toFixed(2)
        : '-';
      const sendDelayMs = Number.isFinite(senderTelemetry.sendDelayMsPerPacket)
        ? senderTelemetry.sendDelayMsPerPacket.toFixed(2)
        : '-';
      const fpsOut = Number.isFinite(senderTelemetry.framesSentPerSec)
        ? senderTelemetry.framesSentPerSec.toFixed(1)
        : '-';
      const fpsEncoded = Number.isFinite(senderTelemetry.framesEncodedPerSec)
        ? senderTelemetry.framesEncodedPerSec.toFixed(1)
        : '-';
      const bitrateKbps = Number.isFinite(senderTelemetry.bytesSentPerSec)
        ? ((senderTelemetry.bytesSentPerSec * 8) / 1000).toFixed(0)
        : '-';
      const qualitySummary = Object.entries(qualityCounts)
        .filter(([, count]) => Number.isFinite(count) && count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `${reason}:${count}`)
        .join('|') || 'none:0';

      logEv('webrtc-sender-telemetry', {
        peers: peerCount,
        fpsOut,
        fpsEncoded,
        encodeMs,
        sendDelayMs,
        bitrateKbps,
        rttMs: avgRttMs,
        quality: qualitySummary,
      });

      const pressureReasons = [];
      if (Number.isFinite(senderTelemetry.framesSentPerSec) && senderTelemetry.framesSentPerSec < 44) {
        pressureReasons.push('low-fps-out');
      }
      if (Number.isFinite(senderTelemetry.encodeMsPerFrame) && senderTelemetry.encodeMsPerFrame > 12) {
        pressureReasons.push('slow-encode');
      }
      if (Number.isFinite(senderTelemetry.sendDelayMsPerPacket) && senderTelemetry.sendDelayMsPerPacket > 4) {
        pressureReasons.push('packet-send-delay');
      }
      if ((qualityCounts.cpu ?? 0) > 0) pressureReasons.push('quality-cpu');
      if ((qualityCounts.bandwidth ?? 0) > 0) pressureReasons.push('quality-bandwidth');

      if (pressureReasons.length > 0) {
        const signature = pressureReasons.join('|');
        const now = Date.now();
        const shouldLogPressure = signature !== lastPressureSignature || (now - lastPressureLogAt) >= 30_000;
        if (shouldLogPressure) {
          lastPressureSignature = signature;
          lastPressureLogAt = now;
          logEv('webrtc-sender-pressure', {
            reasons: signature,
            peers: peerCount,
            fpsOut,
            encodeMs,
            sendDelayMs,
            bitrateKbps,
            quality: qualitySummary,
          });
        }
      }
    }
  }

  function normalizeSessionKey(raw) {
    if (raw == null) return null;
    const value = String(raw).trim();
    if (!value) return null;
    // Avoid pathological/untrusted values bloating logs/maps.
    return value.slice(0, 128);
  }

  function bindControllerSession(controller, rawSession, source = 'offer') {
    const sessionKey = normalizeSessionKey(rawSession);
    if (!sessionKey) return null;
    if (controller.sessionKey === sessionKey) return sessionKey;

    if (controller.sessionKey) {
      const mapped = peerBySession.get(controller.sessionKey);
      if (mapped === controller) peerBySession.delete(controller.sessionKey);
    }

    const previous = peerBySession.get(sessionKey);
    if (previous && previous !== controller) {
      logEv('webrtc-session-replaced', {
        session: sessionKey,
        oldAddr: previous.remoteAddr ?? '-',
        newAddr: controller.remoteAddr ?? '-',
        source,
      });
      try { previous.closePeer?.('session-replaced'); } catch (_) {}
    }

    peerBySession.set(sessionKey, controller);
    controller.sessionKey = sessionKey;
    return sessionKey;
  }

  const senderTelemetryTimer = setInterval(() => {
    sampleSenderTelemetry().catch(() => {});
  }, 5000);

  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildBrowserHtml(inputPort, minBitrateKbpsSafe, maxBitrateKbpsSafe));
    } else if (req.url === '/favicon.ico') {
      // Return a minimal 1×1 transparent ICO so browsers don't log a 404
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  // ── Signalling WS keepalive ───────────────────────────────────────────────
  // After ICE negotiation the signalling WebSocket carries no traffic.
  // Cloud load balancers, Docker bridge NAT, and OS TCP stacks typically
  // drop idle TCP connections after 60–90 s — exactly the symptom observed
  // in production (ws-closed firing ~60 s after ICE connected with no prior
  // ICE disconnect event).
  //
  // Fix: ping every 30 s. The ws library handles pong automatically; we mark
  // each client as alive on pong and terminate any that miss a full interval.
  const PING_INTERVAL_MS = 30_000;
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws._sigAlive === false) {
        // Missed previous pong — connection is dead, terminate it.
        console.error('[webrtc] signalling ws: missed pong, terminating');
        logEv('webrtc-sig-timeout', {});
        ws.terminate();
        return;
      }
      ws._sigAlive = false; // reset; set back to true on pong
      ws.ping();
    });
  }, PING_INTERVAL_MS);

  wss.on('connection', (ws, req) => {
    ws._sigAlive = true; // initialise alive flag
    ws.on('pong', () => { ws._sigAlive = true; });
    const remoteAddr = req.socket.remoteAddress;
    let initialSessionId = null;
    try {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      initialSessionId = reqUrl.searchParams.get('sid')
        || reqUrl.searchParams.get('sessionId')
        || null;
    } catch (_) {}

    // ── Capacity gate ─────────────────────────────────────────────────────────
    // Count active ICE-connected peers + in-flight (pending) connections.
    // Players take 2 of the MAX_CONNECTIONS slots; remaining slots are spectators.
    const currentTotal = activePeers.size + pendingPeers;
    if (currentTotal >= MAX_CONNECTIONS) {
      console.error(`[webrtc] capacity full (${currentTotal}/${MAX_CONNECTIONS}) — rejecting ${remoteAddr}`);
      logEv('webrtc-capacity-full', { addr: remoteAddr, current: currentTotal, max: MAX_CONNECTIONS });
      try {
        ws.send(JSON.stringify({
          type: 'capacity-full',
          current: currentTotal,
          max: MAX_CONNECTIONS,
          maxSpectators,
        }));
      } catch (_) {}
      ws.close();
      return;
    }

    pendingPeers++;
    console.error(`[webrtc] peer connected from ${remoteAddr}`);
    logEv('webrtc-peer-connected', { addr: remoteAddr });
    logLoadSnapshot('webrtc-load-change', { reason: 'peer-connected' });

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const controller = {
      pc,
      ws,
      remoteAddr,
      connected: false,
      iceState: 'new',
      sessionKey: null,
      closePeer: null,
    };
    peerControllers.add(controller);

    // Grace timer: if ICE goes 'disconnected' we wait up to 6s for self-
    // recovery before treating it as fatal. Many transient causes (brief
    // packet loss, NAT keepalive gap, Node GC pause) resolve within 1-2s.
    // Closing immediately on 'disconnected' was the root cause of the
    // periodic video freeze observed in production.
    let disconnectTimer = null;

    function clearDisconnectTimer() {
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
    }

    // Track whether this peer has ever reached ICE connected (to manage pendingPeers correctly).
    let everConnected = false;
    const pendingRemoteCandidates = [];

    async function addRemoteCandidate(candidate, source = 'live') {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        const hasRemoteDescription = !!pc.remoteDescription;
        const signalingState = pc.signalingState;
        const errName = err?.name ?? 'Error';
        const errMsg = err?.message ?? String(err);
        console.error(
          `[webrtc] addIceCandidate failed (${source}) addr=${remoteAddr} hasRemoteDescription=${hasRemoteDescription} signalingState=${signalingState} err=${errName}: ${errMsg}`
        );
        logEv('webrtc-ice-candidate-error', {
          addr: remoteAddr,
          source,
          hasRemoteDescription,
          signalingState,
          err: errName,
        });
      }
    }

    async function flushRemoteCandidates(source = 'post-offer') {
      if (!pc.remoteDescription || pendingRemoteCandidates.length === 0) return;
      const queued = pendingRemoteCandidates.splice(0, pendingRemoteCandidates.length);
      for (const candidate of queued) {
        await addRemoteCandidate(candidate, source);
      }
    }

    function closePeer(reason) {
      clearDisconnectTimer();
      const wasActive = activePeers.delete(pc);
      peerStatsPrev.delete(pc);
      if (controller.sessionKey) {
        const mapped = peerBySession.get(controller.sessionKey);
        if (mapped === controller) peerBySession.delete(controller.sessionKey);
      }
      peerControllers.delete(controller);
      // Decrement pendingPeers only if this peer never made it to ICE connected.
      if (!wasActive && !everConnected) { if (pendingPeers > 0) pendingPeers--; }
      console.error(`[webrtc] closing peer (${remoteAddr}): ${reason}`);
      logEv('webrtc-peer-closed', { addr: remoteAddr, reason });
      logLoadSnapshot('webrtc-load-change', { reason: `peer-closed:${reason}` });
      // Tell the browser the stream died so it can reconnect immediately
      // rather than sitting on a frozen frame.
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: 'peer-closed', reason })); } catch (_) {}
      }
      pc.close();
    }
    controller.closePeer = closePeer;
    bindControllerSession(controller, initialSessionId, 'query');

    // ── Trickle ICE: forward server-side candidates to the browser ───────
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'candidate', candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      controller.iceState = s;
      // Always log ICE state changes — they are infrequent and critical for
      // diagnosing stream freezes. This fires regardless of --verbose.
      console.error(`[webrtc] ICE state → ${s} (${remoteAddr})`);

      if (s === 'connected' || s === 'completed') {
        // Recovered from disconnected — cancel any pending close timer.
        clearDisconnectTimer();
        // First time reaching connected: move out of pending and into active.
        // On recovery from 'disconnected' grace: re-add to active (pendingPeers already at 0 for this peer).
        if (!everConnected) {
          if (pendingPeers > 0) pendingPeers--;
          everConnected = true;
        }
        controller.connected = true;
        activePeers.add(pc);
        logEv('webrtc-ice-connected', { addr: remoteAddr, state: s });
        logLoadSnapshot('webrtc-load-change', { reason: `ice-${s}` });
        logRouteSnapshot(pc, remoteAddr);
        onPeerConnected?.(pc);
      } else if (s === 'disconnected') {
        // Transient — remove from active peers so we stop pushing frames to
        // a peer that may not be receiving them, but do NOT close yet.
        // Give ICE 6 seconds to self-recover before treating it as fatal.
        activePeers.delete(pc);
        controller.connected = false;
        logEv('webrtc-ice-disconnected', { addr: remoteAddr, grace: 6000 });
        logLoadSnapshot('webrtc-load-change', { reason: 'ice-disconnected' });
        disconnectTimer = setTimeout(() => {
          console.error(`[webrtc] ICE 'disconnected' grace expired (${remoteAddr}) — closing`);
          logEv('webrtc-ice-grace-expired', { addr: remoteAddr });
          closePeer('disconnected-timeout');
        }, 6000);
      } else if (s === 'failed' || s === 'closed') {
        logEv('webrtc-ice-terminal', { addr: remoteAddr, state: s });
        closePeer(s);
      } else {
        // checking / new — log but no action needed
        logEv('webrtc-ice-state', { addr: remoteAddr, state: s });
      }
    };

    ws.on('message', async (data) => {
      let msg;
      try {
        msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
      } catch {
        if (verbose) console.error('[webrtc] bad JSON from peer, ignoring');
        return;
      }

      try {
        if (msg.type === 'offer') {
          bindControllerSession(controller, msg.sessionId ?? msg.sid ?? msg.clientSessionId ?? null, 'offer');
          await pc.setRemoteDescription(msg);
          await flushRemoteCandidates('post-offer');

          // ── CRITICAL: tracks must be added BEFORE createAnswer() ─────────
          // onOffer is called synchronously here so the caller can addTrack().
          onOffer?.(pc);

          const answer = await pc.createAnswer();

          // ── Low-latency SDP tweaks ────────────────────────────────────────
          // Inject x-google-min/max-bitrate into the video m-section of the
          // SDP answer. The VP8 encoder in @roamhq/wrtc respects these fmtp
          // parameters: a tight bitrate ceiling (800 kbps for 384×272 @ 50fps
          // is well above visually lossless) forces the encoder to produce
          // smaller frames which reduces encode latency and queuing delay.
          // x-google-min-bitrate prevents the encoder from dropping to 0 kbps
          // (which causes I-frame-only bursts on reconnect).
          let sdp = answer.sdp;
          if (sdp) {
            // Find VP8 payload type in the offer and append fmtp constraints
            sdp = sdp.replace(
              /(a=rtpmap:(\d+) VP8\/\d+\r?\n)/,
              (match, line, pt) => {
                const minKbps = Math.max(50, minBitrateKbpsSafe);
                const maxKbps = Math.max(minKbps, maxBitrateKbpsSafe);
                const fmtp = `a=fmtp:${pt} x-google-min-bitrate=${minKbps};x-google-max-bitrate=${maxKbps}\r\n`;
                return line + fmtp;
              }
            );
            answer.sdp = sdp;
          }

          await pc.setLocalDescription(answer);

          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(pc.localDescription));
          }
          if (verbose) console.error(`[webrtc] answered offer from ${remoteAddr}`);

        } else if (msg.type === 'candidate' && msg.candidate) {
          if (!pc.remoteDescription) {
            pendingRemoteCandidates.push(msg.candidate);
            if (verbose) {
              console.error(`[webrtc] queued remote candidate (${pendingRemoteCandidates.length}) pending offer (${remoteAddr})`);
            }
          } else {
            await addRemoteCandidate(msg.candidate, 'live');
          }
        } else if (msg.type === 'ping') {
          // Browser-side heartbeat — reply immediately so the browser knows
          // the connection is alive and resets its own reconnect timer.
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        console.error('[webrtc] signalling error:', err.message);
      }
    });

    ws.on('close', () => {
      if (verbose) console.error(`[webrtc] peer ws closed (${remoteAddr})`);
      closePeer('ws-closed');
    });

    ws.on('error', (err) => {
      console.error(`[webrtc] ws error (${remoteAddr}):`, err.message);
    });
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.error(`[webrtc] player page    →  http://0.0.0.0:${port}/`);
    console.error(`[webrtc] signalling ws  →  ws://0.0.0.0:${port}/`);
  });

  httpServer.on('error', (err) => {
    console.error(`[webrtc] HTTP server error: ${err.message}`);
  });

  return {
    /**
     * Force an immediate VP8 keyframe (IDR) on all active peer connections.
     *
     * Why this fixes post-load lag:
     *   After c64_loadCartridge() the frame loop resumes but the VP8 encoder
     *   only emits an IDR at its normal interval (~2-3 seconds). The browser
     *   cannot decode any frame until it receives an IDR — so it shows a
     *   frozen/blank screen for up to 2-3 seconds after the load completes,
     *   even though the server is pushing live frames.
     *
     *   Calling sender.replaceTrack(sameTrack) on the video sender triggers
     *   libwebrtc to immediately emit an IDR on the next encoded frame.
     *   The browser decoder gets a complete reference frame within one frame
     *   period (≤20ms @ 50fps) and resumes rendering immediately.
     *
     * @param {MediaStreamTrack} videoTrack  The current video track.
     */
    forceKeyframe(videoTrack) {
      if (!videoTrack) return;
      let count = 0;
      for (const pc of activePeers) {
        try {
          for (const sender of pc.getSenders()) {
            if (sender.track && sender.track.kind === 'video') {
              sender.replaceTrack(videoTrack).catch(() => {});
              count++;
            }
          }
        } catch (_) {}
      }
      if (verbose) console.error(`[webrtc] forceKeyframe: triggered on ${count} sender(s)`);
    },
    getTelemetrySnapshot() {
      return { ...senderTelemetry };
    },
    getPeerSnapshot() {
      const peers = [];
      for (const c of peerControllers) {
        peers.push({
          addr: c.remoteAddr,
          session: c.sessionKey,
          iceState: c.iceState,
          connected: c.connected,
          wsOpen: c.ws && c.ws.readyState === c.ws.OPEN,
        });
      }
      return {
        active: activePeers.size,
        pending: pendingPeers,
        total: activePeers.size + pendingPeers,
        max: MAX_CONNECTIONS,
        peers,
      };
    },
    disconnectPeersByAddr(addr, reason = 'admin-kick') {
      if (!addr) return 0;
      let closed = 0;
      const addrNorm = String(addr).replace(/^::ffff:/, '');
      for (const c of Array.from(peerControllers)) {
        const peerAddrNorm = String(c.remoteAddr ?? '').replace(/^::ffff:/, '');
        if (peerAddrNorm !== addrNorm) continue;
        try {
          c.closePeer?.(reason);
          closed++;
        } catch (_) {}
      }
      return closed;
    },
    disconnectAllPeers(reason = 'admin-kick-all') {
      let closed = 0;
      for (const c of Array.from(peerControllers)) {
        try {
          c.closePeer?.(reason);
          closed++;
        } catch (_) {}
      }
      return closed;
    },
    close: () =>
      new Promise((resolve) => {
        clearInterval(pingInterval);
        clearInterval(senderTelemetryTimer);
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

// ─── Embedded browser-side player page ──────────────────────────────────────
function buildBrowserHtml(inputPort, minBitrateKbps = 200, maxBitrateKbps = 600) {
  const minKbps = Math.max(50, Math.round(minBitrateKbps));
  const maxKbps = Math.max(minKbps, Math.round(maxBitrateKbps));
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>C64 Live</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d0d0d;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: 'Courier New', monospace;
      color: #aaa;
      gap: 10px;
      padding: 16px;
    }

    h1 { font-size: 13px; letter-spacing: 0.2em; color: #555; text-transform: uppercase; }

    /* ── Screen ── */
    #screen-wrap {
      position: relative;
      width: 768px; height: 544px;
      flex-shrink: 0;
    }
    #screen {
      width: 100%; height: 100%;
      image-rendering: pixelated;
      background: #000;
      border: 2px solid #2a2a2a;
      display: block;
      cursor: pointer;
    }
    #screen-wrap.drag-over #screen { border-color: #55f; box-shadow: 0 0 0 2px #338; }

    #mute-overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: #ccc; letter-spacing: 0.1em;
      pointer-events: none;
      transition: opacity 0.3s;
    }
    #mute-overlay.hidden { opacity: 0; }

    /* ── Status bar ── */
    .status-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 11px; }
    .badge {
      padding: 2px 8px; border-radius: 3px; background: #1a1a1a;
      border: 1px solid #2a2a2a; letter-spacing: 0.05em; white-space: nowrap;
    }
    .badge.ok   { color: #4f4; border-color: #262; }
    .badge.warn { color: #fa0; border-color: #540; }
    .badge.err  { color: #f44; border-color: #422; }
    .badge.dim  { color: #444; }

    /* ── Controls bar ── */
    .controls-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    button {
      padding: 5px 12px; border-radius: 3px; border: 1px solid #333;
      background: #1a1a1a; color: #aaa; font-family: inherit; font-size: 11px;
      cursor: pointer; letter-spacing: 0.05em; transition: background 0.15s;
    }
    button:hover { background: #252525; border-color: #555; color: #ddd; }
    button:disabled { opacity: 0.35; cursor: default; }
    button.hidden { display: none; }
    button.active { background: #1a2a1a; color: #8f8; border-color: #464; }

    /* ── CRT drop zone hint ── */
    #drop-hint {
      font-size: 11px; color: #333; letter-spacing: 0.08em;
    }

    /* ── Load progress ── */
    #load-status { font-size: 11px; min-width: 120px; }

    /* ── Separator ── */
    .sep { color: #2a2a2a; user-select: none; }

    input[type=file] { display: none; }
  </style>
</head>
<body>
  <h1>C64 Live</h1>

  <div id="screen-wrap">
    <video id="screen" autoplay playsinline muted></video>
    <div id="mute-overlay">🔇 click to unmute</div>
  </div>

  <div class="status-row">
    <span id="video-status" class="badge dim">video: connecting…</span>
    <span id="audio-status" class="badge dim">audio: muted</span>
    <span id="input-status" class="badge dim">input: connecting…</span>
    <span id="game-status"  class="badge dim">no game</span>
  </div>

  <div class="controls-row">
    <button id="load-btn"   title="Load a .crt cartridge file">📂 load .crt</button>
    <button id="detach-btn" title="Eject cartridge → BASIC prompt" disabled>⏏ detach</button>
    <button id="reset-btn"  title="Hard reset (BASIC prompt)" disabled>↺ reset</button>
    <span class="sep">|</span>
    <button id="sync-btn"   title="Flush video to live edge — use if display feels laggy">⟳ sync</button>
    <span class="sep">|</span>
    <button id="mode-btn"   title="Toggle input mode">🕹+⌨ mixed</button>
    <span class="sep">|</span>
    <span id="load-status" class="badge dim"></span>
    <span id="drop-hint">or drop .crt onto screen</span>
    <input type="file" id="file-input" accept=".crt">
  </div>

  <script>
    // ── Element refs ─────────────────────────────────────────────────────────
    const videoEl     = document.getElementById('screen');
    const screenWrap  = document.getElementById('screen-wrap');
    const muteOverlay = document.getElementById('mute-overlay');
    const videoBadge  = document.getElementById('video-status');
    const audioBadge  = document.getElementById('audio-status');
    const inputBadge  = document.getElementById('input-status');
    const gameBadge   = document.getElementById('game-status');
    const loadStatus  = document.getElementById('load-status');
    const loadBtn     = document.getElementById('load-btn');
    const detachBtn   = document.getElementById('detach-btn');
    const resetBtn    = document.getElementById('reset-btn');
    const syncBtn     = document.getElementById('sync-btn');
    const modeBtn     = document.getElementById('mode-btn');
    const fileInput   = document.getElementById('file-input');

    function setBadge(el, text, cls) {
      el.textContent = text;
      el.className = 'badge ' + (cls || 'dim');
    }

    // ── Audio ─────────────────────────────────────────────────────────────────
    let audioCtx = null, analyserTimer = null, audioConfirmed = false;
    let remoteStream = null;

    function startAudioMonitor(stream) {
      if (audioCtx || audioConfirmed) return;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaStreamSource(stream);
        const an  = audioCtx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        analyserTimer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          if (Math.sqrt(sum / buf.length) > 0.001) {
            audioConfirmed = true;
            clearInterval(analyserTimer); analyserTimer = null;
            setBadge(audioBadge, '🔊 audio on', 'ok');
          }
        }, 200);
        setTimeout(() => {
          if (!audioConfirmed && analyserTimer) {
            clearInterval(analyserTimer); analyserTimer = null;
            audioConfirmed = true;
            setBadge(audioBadge, '🔊 on (silent)', 'ok');
          }
        }, 8000);
      } catch (_) { setBadge(audioBadge, 'audio error', 'err'); }
    }

    videoEl.addEventListener('click', () => {
      if (videoEl.muted) {
        videoEl.muted = false;
        muteOverlay.classList.add('hidden');
        setBadge(audioBadge, 'starting…', 'warn');
        if (remoteStream) startAudioMonitor(remoteStream);
        else {
          const t = setInterval(() => { if (remoteStream) { clearInterval(t); startAudioMonitor(remoteStream); } }, 300);
        }
      }
    });

    // ── WebRTC ────────────────────────────────────────────────────────────────
    // pc and sigWs are module-level so reconnectWebRTC() can tear them down.
    let pc = null;
    let sigWs = null;
    let driftTimer = null;
    let rtcReconnectTimer = null;
    let sigPingTimer = null;  // keepalive ping on the signalling WS

    function scheduleRtcReconnect(delayMs) {
      if (rtcReconnectTimer) return; // already scheduled
      setBadge(videoBadge, 'video: reconnecting…', 'warn');
      rtcReconnectTimer = setTimeout(() => {
        rtcReconnectTimer = null;
        connectWebRTC();
      }, delayMs);
    }

    function applyMinLatency() {
      if (!pc) return;
      for (const r of pc.getReceivers()) {
        if ('jitterBufferTarget' in r) r.jitterBufferTarget = 0;
      }
    }

    function startDriftMonitor() {
      stopDriftMonitor();
      driftTimer = setInterval(() => {
        if (!videoEl || !remoteStream || videoEl.paused || videoEl.readyState < 2) return;
        const buf = videoEl.buffered;
        if (!buf || buf.length === 0) return;
        const bufEnd = buf.end(buf.length - 1);
        const drift  = bufEnd - videoEl.currentTime;
        if (drift > 0.3) {
          console.warn('[WebRTC] drift ' + (drift*1000).toFixed(0) + 'ms — skipping to live edge');
          videoEl.currentTime = bufEnd;
        }
      }, 200);
    }

    function stopDriftMonitor() {
      if (driftTimer) { clearInterval(driftTimer); driftTimer = null; }
    }

    function flushToLiveEdge() {
      applyMinLatency();
      if (!videoEl || !remoteStream) return;
      const buf = videoEl.buffered;
      if (buf && buf.length > 0) {
        const bufEnd = buf.end(buf.length - 1);
        const drift  = bufEnd - videoEl.currentTime;
        console.log('[WebRTC] flushToLiveEdge: drift=' + (drift*1000).toFixed(0) + 'ms → skip to live edge');
        videoEl.currentTime = bufEnd;
      }
      videoEl.play().catch(() => {});
    }

    function connectWebRTC() {
      // Cancel any pending auto-reconnect so we don't double-connect.
      if (rtcReconnectTimer) { clearTimeout(rtcReconnectTimer); rtcReconnectTimer = null; }
      if (sigPingTimer) { clearInterval(sigPingTimer); sigPingTimer = null; }
      // Tear down any existing connection cleanly first.
      stopDriftMonitor();
      if (pc) { try { pc.close(); } catch (_) {} pc = null; }
      if (sigWs && sigWs.readyState !== WebSocket.CLOSED) {
        // Remove onclose so it doesn't update the badge during our intentional teardown
        sigWs.onclose = null;
        try { sigWs.close(); } catch (_) {}
        sigWs = null;
      }
      remoteStream = null;
      videoEl.srcObject = null;

      setBadge(videoBadge, 'video: connecting…', 'dim');

      function getOrCreateSessionId() {
        try {
          const key = 'c64live.webrtcSessionId';
          const existing = localStorage.getItem(key);
          if (existing) return existing;
          const created = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
            ? globalThis.crypto.randomUUID()
            : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
          localStorage.setItem(key, created);
          return created;
        } catch (_) {
          return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        }
      }
      const rtcSessionId = getOrCreateSessionId();
      const sigUrl = new URL('ws://' + location.host);
      sigUrl.searchParams.set('sid', rtcSessionId);
      sigWs = new WebSocket(sigUrl.toString());
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      let offerSent = false;
      const pendingLocalCandidates = [];
      const pendingRemoteCandidates = [];

      function sendSignal(msg) {
        if (!sigWs || sigWs.readyState !== WebSocket.OPEN) return;
        sigWs.send(JSON.stringify(msg));
      }

      function flushLocalCandidates() {
        if (!offerSent || !sigWs || sigWs.readyState !== WebSocket.OPEN) return;
        while (pendingLocalCandidates.length > 0) {
          const candidate = pendingLocalCandidates.shift();
          if (!candidate) continue;
          sendSignal({ type: 'candidate', candidate });
        }
      }

      async function addRemoteCandidate(candidate, source) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          const hasRemoteDescription = !!pc.remoteDescription;
          const signalingState = pc.signalingState;
          const errName = err && err.name ? err.name : 'Error';
          const errMsg = err && err.message ? err.message : String(err);
          console.warn('[WebRTC] addIceCandidate failed (' + source + ') hasRemoteDescription=' + hasRemoteDescription + ' signalingState=' + signalingState + ' err=' + errName + ': ' + errMsg);
        }
      }

      async function flushRemoteCandidates() {
        if (!pc.remoteDescription || pendingRemoteCandidates.length === 0) return;
        const queued = pendingRemoteCandidates.splice(0, pendingRemoteCandidates.length);
        for (const candidate of queued) {
          await addRemoteCandidate(candidate, 'post-answer');
        }
      }

      pc.ontrack = (e) => {
        if (e.streams && e.streams[0]) {
          remoteStream = e.streams[0];
          videoEl.srcObject = remoteStream;
          setBadge(videoBadge, 'video: live', 'ok');
          applyMinLatency();
          startDriftMonitor();
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return;
        if (!offerSent) {
          pendingLocalCandidates.push(candidate);
          return;
        }
        if (sigWs && sigWs.readyState === WebSocket.OPEN) {
          sendSignal({ type: 'candidate', candidate });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        if (s === 'connected' || s === 'completed') {
          setBadge(videoBadge, 'video: live', 'ok');
        } else if (s === 'disconnected') {
          // Transient — server gives 6s grace, show warning but wait.
          setBadge(videoBadge, 'video: unstable…', 'warn');
        } else if (s === 'failed') {
          // ICE has fully given up — reconnect after a short delay.
          setBadge(videoBadge, 'video: reconnecting…', 'warn');
          scheduleRtcReconnect(1000);
        } else if (s === 'closed') {
          setBadge(videoBadge, 'video: closed', 'err');
        }
      };

      sigWs.onopen = async () => {
        setBadge(videoBadge, 'video: negotiating…', 'warn');
        // Start keepalive ping — prevents the idle TCP connection from being
        // dropped by cloud NAT / load balancers (~60s timeout observed in prod).
        sigPingTimer = setInterval(() => {
          if (sigWs && sigWs.readyState === WebSocket.OPEN) {
            sigWs.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
        let transceiver = null;
        try {
          transceiver = pc.addTransceiver('video', { direction: 'recvonly' });
          pc.addTransceiver('audio', { direction: 'recvonly' });
        } catch (_) {}
        try {
          if (transceiver && typeof transceiver.setCodecPreferences === 'function') {
            const caps = RTCRtpReceiver.getCapabilities('video');
            if (caps) {
              const vp8 = caps.codecs.filter(c => c.mimeType === 'video/VP8');
              const rest = caps.codecs.filter(c => c.mimeType !== 'video/VP8');
              if (vp8.length) transceiver.setCodecPreferences([...vp8, ...rest]);
            }
          }
        } catch (_) {}
        const offer = await pc.createOffer();
        if (offer.sdp) {
          offer.sdp = offer.sdp.replace(
            /(a=rtpmap:(\\d+) VP8\\/\\d+\\r?\\n)/,
            function(m, line, pt) { return line + 'a=fmtp:' + pt + ' x-google-min-bitrate=${minKbps};x-google-max-bitrate=${maxKbps}\\r\\n'; }
          );
        }
        await pc.setLocalDescription(offer);
        const local = pc.localDescription;
        if (!local || !local.type || !local.sdp) {
          throw new Error('Local offer description missing type/sdp');
        }
        sendSignal({ type: local.type, sdp: local.sdp, sessionId: rtcSessionId });
        offerSent = true;
        flushLocalCandidates();
      };

      sigWs.onmessage = async ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.type === 'answer') {
          await pc.setRemoteDescription(msg);
          await flushRemoteCandidates();
          applyMinLatency();
        } else if (msg.type === 'candidate') {
          if (!msg.candidate) return;
          if (!pc.remoteDescription) {
            pendingRemoteCandidates.push(msg.candidate);
            return;
          }
          await addRemoteCandidate(msg.candidate, 'live');
        } else if (msg.type === 'pong') {
          // Server acknowledged our keepalive ping — connection is healthy.
        } else if (msg.type === 'peer-closed') {
          // Server closed the peer (e.g. after disconnect grace expired).
          // Reconnect immediately — this is the expected recovery path.
          console.warn('[WebRTC] server closed peer (' + (msg.reason || '?') + ') — reconnecting');
          scheduleRtcReconnect(500);
        } else if (msg.type === 'capacity-full') {
          // Server is at capacity — do not auto-reconnect; show a message instead.
          console.warn('[WebRTC] server at capacity (' + msg.current + '/' + msg.max + ' connections)');
          setBadge(videoBadge, 'server full — try later', 'err');
          setBadge(inputBadge, 'input: unavailable', 'err');
          // Cancel any pending reconnect so we don't spam the server.
          if (rtcReconnectTimer) { clearTimeout(rtcReconnectTimer); rtcReconnectTimer = null; }
          stopDriftMonitor();
        }
      };

      sigWs.onerror = () => setBadge(videoBadge, 'video: sig error', 'err');
      sigWs.onclose = () => {
        if (sigPingTimer) { clearInterval(sigPingTimer); sigPingTimer = null; }
        // Signalling WS closed — could be server restart or network blip.
        // Reconnect after 2s so we don't spin.
        setBadge(videoBadge, 'video: reconnecting…', 'warn');
        scheduleRtcReconnect(2000);
      };
    }

    // Initial connection
    connectWebRTC();

    // ── Input server ──────────────────────────────────────────────────────────
    const INPUT_PORT = ${inputPort};
    let inputWs = null, inputBackoff = 1000, backoffTimer = null;

    function connectInput() {
      if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
      setBadge(inputBadge, 'input: connecting…', 'warn');
      inputWs = new WebSocket('ws://' + location.hostname + ':' + INPUT_PORT);

      inputWs.onopen = () => {
        inputBackoff = 1000;
        setBadge(inputBadge, 'input: connected', 'ok');
        // Claim host role — force:true evicts any stale previous session so
        // detach / reset always work even after a page reload or reconnect.
        inputWs.send(JSON.stringify({ type: 'host', username: 'player', force: true }));
      };

      inputWs.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data);
          // Cart lifecycle
          if (msg.type === 'cart-loaded' || msg.type === 'machine-reset' || msg.type === 'cart-detached') {
            blurAll();
            const cartName = msg.filename ? msg.filename.replace(/\\.crt$/i,'').replace(/[-_]/g,' ') : '';
            if (msg.type === 'cart-loaded')   { setBadge(gameBadge, '🎮 ' + (cartName || 'game loaded'), 'ok');  setLoadStatus('loaded', 'ok');  detachBtn.disabled = false; resetBtn.disabled = false; }
            if (msg.type === 'cart-detached') { setBadge(gameBadge, 'no game', 'dim'); setLoadStatus('', '');    detachBtn.disabled = true; }
            if (msg.type === 'machine-reset') { setLoadStatus('reset', 'warn'); }
            // Reconnect the RTCPeerConnection entirely — this is the only
            // reliable way to clear the jitter buffer and decoder state that
            // accumulates during the ~1600ms cart-load gap.  Anything less
            // (currentTime seek, srcObject null, jitterBufferTarget) leaves
            // stale decoded frames in the pipeline.  A fresh pc + renegotiate
            // is equivalent to a browser refresh but without losing input WS.
            // Preserve mute state so the user doesn't lose audio they unmuted.
            const wasMuted = videoEl.muted;
            connectWebRTC();
            // Re-apply mute state after the new video element srcObject is set
            // (ontrack fires asynchronously, so check after a short delay)
            if (!wasMuted) {
              const t = setInterval(() => {
                if (remoteStream) {
                  videoEl.muted = false;
                  muteOverlay.classList.add('hidden');
                  clearInterval(t);
                }
              }, 100);
            }
          }
          if (msg.type === 'hello' && msg.cartFilename) {
            const cartName = msg.cartFilename.replace(/\\.crt$/i,'').replace(/[-_]/g,' ');
            setBadge(gameBadge, '🎮 ' + (cartName || 'game loaded'), 'ok');
            setLoadStatus('loaded', 'ok');
            detachBtn.disabled = false;
            resetBtn.disabled = false;
          }
          if (msg.type === 'cart-loading')    setLoadStatus('loading…', 'warn');
          if (msg.type === 'cart-load-error') setLoadStatus('error: ' + (msg.reason || '?'), 'err');
          if (msg.type === 'host-confirmed')  setBadge(inputBadge, 'input: host', 'ok');
        } catch (_) {}
      };
      inputWs.onclose = () => {
        setBadge(inputBadge, 'input: retrying ' + (inputBackoff/1000).toFixed(0) + 's…', 'warn');
        backoffTimer = setTimeout(() => { inputBackoff = Math.min(inputBackoff * 2, 30000); connectInput(); }, inputBackoff);
      };
      inputWs.onerror = () => setBadge(inputBadge, 'input: unavailable', 'err');
    }
    function sendInput(msg) {
      if (inputWs && inputWs.readyState === WebSocket.OPEN) inputWs.send(JSON.stringify(msg));
    }
    // Blur any focused UI element so keyboard events go to the emulator,
    // not to whichever button was last clicked.
    function blurAll() {
      if (document.activeElement && document.activeElement !== document.body)
        document.activeElement.blur();
    }
    connectInput();
    function setLoadStatus(text, cls) {
      loadStatus.textContent = text;
      loadStatus.className = 'badge ' + (cls || 'dim');
    }
    // ── CRT loading ───────────────────────────────────────────────────────────
    async function loadCrt(file) {
      if (!file) return;
      setLoadStatus('reading…', 'warn');
      try {
        const b64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => { const r = reader.result; resolve(r.slice(r.indexOf(',') + 1)); };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        setLoadStatus('sending…', 'warn');
        sendInput({ type: 'load-crt', filename: file.name, data: b64 });
      } catch (e) {
        setLoadStatus('read error', 'err');
      }
    }
    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { const f = e.target?.files?.[0]; if (f) loadCrt(f); fileInput.value = ''; blurAll(); });
    screenWrap.addEventListener('dragover',  (e) => { e.preventDefault(); screenWrap.classList.add('drag-over'); });
    screenWrap.addEventListener('dragleave', ()  => screenWrap.classList.remove('drag-over'));
    screenWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      screenWrap.classList.remove('drag-over');
      const f = e.dataTransfer?.files?.[0];
      if (f) loadCrt(f);
    });
    detachBtn.addEventListener('click', () => { sendInput({ type: 'detach-crt' }); setLoadStatus('detaching…', 'warn'); blurAll(); });
    resetBtn.addEventListener('click',  () => { sendInput({ type: 'hard-reset' });  setLoadStatus('resetting…', 'warn'); blurAll(); });
    syncBtn.addEventListener('click', () => {
      const wasMuted = videoEl.muted;
      connectWebRTC();
      if (!wasMuted) {
        const t = setInterval(() => { if (remoteStream) { videoEl.muted = false; muteOverlay.classList.add('hidden'); clearInterval(t); } }, 100);
      }
      syncBtn.textContent = '✓ synced';
      setTimeout(() => { syncBtn.textContent = '⟳ sync'; }, 1500);
      blurAll();
    });
    // ── Input mode ────────────────────────────────────────────────────────────
    const MODES = ['mixed', 'joy', 'kb'];
    const MODE_LABELS = { mixed: '🕹+⌨ mixed', joy: '🕹 joystick', kb: '⌨ keyboard' };
    let modeIdx = 0;
    modeBtn.addEventListener('click', () => {
      modeIdx = (modeIdx + 1) % MODES.length;
      modeBtn.textContent = MODE_LABELS[MODES[modeIdx]];
      modeBtn.classList.toggle('active', MODES[modeIdx] === 'joy');
    });
    function getMode() { return MODES[modeIdx]; }
    const JOY_MAP = {
      ArrowUp: { direction: 'up' }, ArrowDown: { direction: 'down' },
      ArrowLeft: { direction: 'left' }, ArrowRight: { direction: 'right' },
      z: { fire: true }, Z: { fire: true }, x: { fire: true }, X: { fire: true },
    };
    const MIXED_JOY_KEYS = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','z','Z','x','X']);
    const PREVENT_DEFAULTS = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Tab']);
    document.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULTS.has(e.key)) e.preventDefault();
      if (e.repeat) return;
      const tag = e.target instanceof Element ? e.target.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mode = getMode();
      const j = JOY_MAP[e.key];
      if (mode === 'joy') {
        if (j) sendInput({ type: 'joystick', joystickPort: 2, action: 'push', direction: j.direction, fire: j.fire ?? false });
      } else if (mode === 'mixed') {
        if (j) sendInput({ type: 'joystick', joystickPort: 2, action: 'push', direction: j.direction, fire: j.fire ?? false });
        if (!MIXED_JOY_KEYS.has(e.key)) sendInput({ type: 'key', key: e.key, shiftKey: e.shiftKey, action: 'down' });
      } else {
        sendInput({ type: 'key', key: e.key, shiftKey: e.shiftKey, action: 'down' });
      }
    });
    document.addEventListener('keyup', (e) => {
      const tag = e.target instanceof Element ? e.target.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mode = getMode();
      const j = JOY_MAP[e.key];
      if (mode === 'joy') {
        if (j) sendInput({ type: 'joystick', joystickPort: 2, action: 'release', direction: j.direction, fire: j.fire ?? false });
      } else if (mode === 'mixed') {
        if (j) sendInput({ type: 'joystick', joystickPort: 2, action: 'release', direction: j.direction, fire: j.fire ?? false });
        if (!MIXED_JOY_KEYS.has(e.key)) sendInput({ type: 'key', key: e.key, shiftKey: e.shiftKey, action: 'up' });
      } else {
        sendInput({ type: 'key', key: e.key, shiftKey: e.shiftKey, action: 'up' });
      }
    });
  </script>
</body>
</html>`;
}
