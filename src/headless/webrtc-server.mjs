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

  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildBrowserHtml(inputPort));
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
    console.error(`[webrtc] peer connected from ${remoteAddr}`);
    logEv('webrtc-peer-connected', { addr: remoteAddr });

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // Grace timer: if ICE goes 'disconnected' we wait up to 6s for self-
    // recovery before treating it as fatal. Many transient causes (brief
    // packet loss, NAT keepalive gap, Node GC pause) resolve within 1-2s.
    // Closing immediately on 'disconnected' was the root cause of the
    // periodic video freeze observed in production.
    let disconnectTimer = null;

    function clearDisconnectTimer() {
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
    }

    function closePeer(reason) {
      clearDisconnectTimer();
      activePeers.delete(pc);
      console.error(`[webrtc] closing peer (${remoteAddr}): ${reason}`);
      logEv('webrtc-peer-closed', { addr: remoteAddr, reason });
      // Tell the browser the stream died so it can reconnect immediately
      // rather than sitting on a frozen frame.
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: 'peer-closed', reason })); } catch (_) {}
      }
      pc.close();
    }

    // ── Trickle ICE: forward server-side candidates to the browser ───────
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'candidate', candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      // Always log ICE state changes — they are infrequent and critical for
      // diagnosing stream freezes. This fires regardless of --verbose.
      console.error(`[webrtc] ICE state → ${s} (${remoteAddr})`);

      if (s === 'connected' || s === 'completed') {
        // Recovered from disconnected — cancel any pending close timer.
        clearDisconnectTimer();
        activePeers.add(pc);
        logEv('webrtc-ice-connected', { addr: remoteAddr, state: s });
        onPeerConnected?.(pc);
      } else if (s === 'disconnected') {
        // Transient — remove from active peers so we stop pushing frames to
        // a peer that may not be receiving them, but do NOT close yet.
        // Give ICE 6 seconds to self-recover before treating it as fatal.
        activePeers.delete(pc);
        logEv('webrtc-ice-disconnected', { addr: remoteAddr, grace: 6000 });
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
          await pc.setRemoteDescription(msg);

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
                const fmtp = `a=fmtp:${pt} x-google-min-bitrate=200;x-google-max-bitrate=800\r\n`;
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
          await pc.addIceCandidate(msg.candidate);
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
    close: () =>
      new Promise((resolve) => {
        clearInterval(pingInterval);
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

// ─── Embedded browser-side player page ──────────────────────────────────────
function buildBrowserHtml(inputPort) {
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

      sigWs = new WebSocket('ws://' + location.host);
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

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
        if (candidate && sigWs && sigWs.readyState === WebSocket.OPEN)
          sigWs.send(JSON.stringify({ type: 'candidate', candidate }));
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
            function(m, line, pt) { return line + 'a=fmtp:' + pt + ' x-google-min-bitrate=200;x-google-max-bitrate=800\\r\\n'; }
          );
        }
        await pc.setLocalDescription(offer);
        sigWs.send(JSON.stringify(pc.localDescription));
      };

      sigWs.onmessage = async ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.type === 'answer') {
          await pc.setRemoteDescription(msg);
          applyMinLatency();
        } else if (msg.type === 'candidate') {
          await pc.addIceCandidate(msg.candidate).catch(() => {});
        } else if (msg.type === 'pong') {
          // Server acknowledged our keepalive ping — connection is healthy.
        } else if (msg.type === 'peer-closed') {
          // Server closed the peer (e.g. after disconnect grace expired).
          // Reconnect immediately — this is the expected recovery path.
          console.warn('[WebRTC] server closed peer (' + (msg.reason || '?') + ') — reconnecting');
          scheduleRtcReconnect(500);
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
        // Claim host role immediately
        inputWs.send(JSON.stringify({ type: 'host', username: 'player' }));
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
