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
  inputPort = 9001,
  onOffer,
  onPeerConnected,
} = {}) {
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

  wss.on('connection', (ws, req) => {
    const remoteAddr = req.socket.remoteAddress;
    if (verbose) console.error(`[webrtc] peer connected from ${remoteAddr}`);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // ── Trickle ICE: forward server-side candidates to the browser ───────
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'candidate', candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (verbose) console.error(`[webrtc] ICE state → ${pc.iceConnectionState} (${remoteAddr})`);
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        onPeerConnected?.(pc);
      }
      if (s === 'failed' || s === 'closed' || s === 'disconnected') {
        if (verbose) console.error(`[webrtc] closing peer (${remoteAddr}): ICE ${s}`);
        pc.close();
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
          await pc.setLocalDescription(answer);

          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(pc.localDescription));
          }
          if (verbose) console.error(`[webrtc] answered offer from ${remoteAddr}`);

        } else if (msg.type === 'candidate' && msg.candidate) {
          await pc.addIceCandidate(msg.candidate);
        }
      } catch (err) {
        console.error('[webrtc] signalling error:', err.message);
      }
    });

    ws.on('close', () => {
      if (verbose) console.error(`[webrtc] peer ws closed (${remoteAddr})`);
      pc.close();
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
    close: () =>
      new Promise((resolve) => {
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
  <title>C64 Live — WebRTC</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #111;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: monospace;
      color: #aaa;
      gap: 8px;
    }
    #screen {
      width: 768px;
      height: 544px;
      image-rendering: pixelated;
      background: #000;
      border: 2px solid #333;
      display: block;
    }
    .status-row { display: flex; gap: 16px; font-size: 12px; letter-spacing: 0.05em; }
    .badge { padding: 2px 8px; border-radius: 3px; background: #222; }
    .badge.ok     { color: #4f4; }
    .badge.warn   { color: #fa0; }
    .badge.err    { color: #f44; }
    .badge.dim    { color: #555; }
    #input-btn {
      padding: 4px 14px; border-radius: 3px; border: 1px solid #444;
      background: #222; color: #aaa; font-family: monospace; font-size: 12px;
      cursor: pointer; letter-spacing: 0.05em;
    }
    #input-btn:hover { background: #2a2a2a; border-color: #666; }
    #input-btn:disabled { opacity: 0.4; cursor: default; }
    #input-btn.hidden { display: none; }
    #mode-btn {
      padding: 4px 14px; border-radius: 3px; border: 1px solid #446;
      background: #1a1a2a; color: #88f; font-family: monospace; font-size: 12px;
      cursor: pointer; letter-spacing: 0.05em;
    }
    #mode-btn:hover { background: #222233; border-color: #66a; }
    #mode-btn.joystick { background: #1a2a1a; color: #8f8; border-color: #464; }
    #mode-btn.joystick:hover { background: #223322; }
  </style>
</head>
<body>
  <video id="screen" autoplay playsinline muted></video>
  <div class="status-row">
    <span id="video-status" class="badge">video: connecting…</span>
    <span id="audio-status" class="badge dim">🔇 click screen for audio</span>
    <span id="input-status" class="badge dim">input: connecting…</span>
    <button id="input-btn" class="hidden">reconnect input</button>
    <button id="mode-btn" title="Toggle between keyboard and joystick input mode">⌨ keyboard</button>
  </div>

  <script>
    const videoEl      = document.getElementById('screen');
    const videoStatus  = document.getElementById('video-status');
    const audioStatus  = document.getElementById('audio-status');
    const inputStatus  = document.getElementById('input-status');

    function setVideo(text, cls) {
      videoStatus.textContent = 'video: ' + text;
      videoStatus.className = 'badge ' + (cls || '');
    }
    function setAudio(text, cls) {
      audioStatus.textContent = text;
      audioStatus.className = 'badge ' + (cls || 'dim');
    }
    function setInput(text, cls) {
      inputStatus.textContent = 'input: ' + text;
      inputStatus.className = 'badge ' + (cls || 'dim');
    }

    // ── Audio detection via AnalyserNode ──────────────────────────────────────
    // Browsers autoplay muted video but require a user gesture to unmute.
    // Once the user clicks, we:
    //   1. Unmute the video element
    //   2. Create an AudioContext and wire the stream's audio track to an
    //      AnalyserNode that measures RMS signal level every 200 ms
    //   3. When RMS > threshold (actual SID audio flowing), update the badge
    // This gives a real confirmation that audio is working, not just that
    // the element was unmuted.
    let audioCtx       = null;
    let analyserTimer  = null;
    let audioConfirmed = false;

    function startAudioMonitor(stream) {
      if (audioCtx || audioConfirmed) return;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source   = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const buf = new Float32Array(analyser.fftSize);
        analyserTimer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          // RMS of the signal
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          if (rms > 0.001) {
            // Non-trivial signal detected — audio is live
            audioConfirmed = true;
            clearInterval(analyserTimer);
            analyserTimer = null;
            setAudio('🔊 audio on', 'ok');
          }
        }, 200);

        // Timeout: if no signal after 8 s the SID may be silent (BASIC prompt)
        // — show 'audio on (silent)' so the user knows it's unmuted but quiet.
        setTimeout(() => {
          if (!audioConfirmed && analyserTimer) {
            clearInterval(analyserTimer);
            analyserTimer = null;
            audioConfirmed = true;
            setAudio('🔊 audio on (silent)', 'ok');
          }
        }, 8000);

      } catch (err) {
        setAudio('audio error', 'err');
      }
    }

    // ── WebRTC signalling ────────────────────────────────────────────────────
    const sigWs = new WebSocket('ws://' + location.host);
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    let remoteStream = null;

    pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        remoteStream = e.streams[0];
        videoEl.srcObject = remoteStream;
        setVideo('live', 'ok');

        // ── Minimise jitter buffer to show only the latest frame ─────────
        // jitterBufferTarget = 0 tells the browser to buffer as little as
        // possible (ideally 0 ms), effectively "buffer size of 1": stale
        // frames are dropped rather than queued, keeping playback at the
        // live edge. Supported in Chrome 87+ / Edge 87+; silently ignored
        // in Firefox/Safari where it is undefined.
        try {
          for (const receiver of pc.getReceivers()) {
            if ('jitterBufferTarget' in receiver) {
              receiver.jitterBufferTarget = 0;
            }
          }
        } catch (_) {}

        // ── Live-edge enforcement via getStats() + playbackRate ───────────
        // WebRTC video arrives through a jitter buffer, not a seekable media
        // source, so videoEl.buffered is always empty — seeking currentTime
        // does nothing.  Instead we use RTCPeerConnection.getStats() to read
        // jitterBufferDelay / jitterBufferEmittedCount and compute the
        // average jitter buffer delay.  When it exceeds one frame (20 ms @
        // 50 fps) we speed up playback slightly (1.02×) to drain the buffer;
        // once it falls below 10 ms we return to 1.0×.
        // Polled every 2 s — low overhead, invisible to the user.
        const CATCHUP_RATE   = 1.02;
        const LAG_THRESH_S   = 0.020; // start catching up above 20 ms
        const SYNC_THRESH_S  = 0.010; // return to normal below 10 ms
        let prevJitterDelay  = 0;
        let prevJitterCount  = 0;
        setInterval(async () => {
          if (!pc || videoEl.paused) return;
          try {
            const stats = await pc.getStats();
            for (const report of stats.values()) {
              if (report.type === 'inbound-rtp' && report.kind === 'video') {
                const delay = report.jitterBufferDelay   ?? 0;
                const count = report.jitterBufferEmittedCount ?? 0;
                const dDelay = delay - prevJitterDelay;
                const dCount = count - prevJitterCount;
                prevJitterDelay = delay;
                prevJitterCount = count;
                if (dCount > 0) {
                  const avgDelayS = dDelay / dCount;
                  if (avgDelayS > LAG_THRESH_S && videoEl.playbackRate === 1.0) {
                    videoEl.playbackRate = CATCHUP_RATE;
                  } else if (avgDelayS < SYNC_THRESH_S && videoEl.playbackRate !== 1.0) {
                    videoEl.playbackRate = 1.0;
                  }
                }
                break;
              }
            }
          } catch (_) {}
        }, 2000);
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && sigWs.readyState === WebSocket.OPEN) {
        sigWs.send(JSON.stringify({ type: 'candidate', candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') setVideo('live', 'ok');
      if (s === 'failed' || s === 'disconnected')  setVideo('reconnecting…', 'warn');
      if (s === 'closed')                          setVideo('disconnected', 'err');
    };

    sigWs.onopen = async () => {
      setVideo('negotiating…');
      const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      sigWs.send(JSON.stringify(pc.localDescription));
    };

    sigWs.onmessage = async ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.type === 'answer')         await pc.setRemoteDescription(msg);
      else if (msg.type === 'candidate') await pc.addIceCandidate(msg.candidate).catch(() => {});
    };

    sigWs.onerror = () => setVideo('signalling error', 'err');
    sigWs.onclose = () => setVideo('signalling closed', 'err');

    // ── Input forwarding ─────────────────────────────────────────────────────
    // Auto-connects on page load. The input server is always running in WebRTC
    // mode (the entrypoint starts it unconditionally alongside --webrtc).
    // On disconnect: exponential backoff reconnect (1s → 2s → … → 30s cap).
    // The "reconnect input" button appears after the first failure so the user
    // can force an immediate retry without waiting for the backoff timer.
    const INPUT_PORT   = ${inputPort};
    const inputBtn     = document.getElementById('input-btn');
    let inputWs        = null;
    let inputBackoff   = 1000;
    let inputConnected = false;
    let backoffTimer   = null;

    function connectInput() {
      if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
      inputBtn.classList.add('hidden');
      setInput('connecting…', 'warn');

      inputWs = new WebSocket('ws://' + location.hostname + ':' + INPUT_PORT);

      inputWs.onopen = () => {
        inputConnected = true;
        inputBackoff   = 1000;
        inputBtn.classList.add('hidden');
        setInput('connected', 'ok');
      };

      inputWs.onclose = () => {
        inputConnected = false;
        setInput('disconnected — retrying in ' + (inputBackoff / 1000).toFixed(0) + 's…', 'warn');
        inputBtn.classList.remove('hidden');
        backoffTimer = setTimeout(() => {
          inputBackoff = Math.min(inputBackoff * 2, 30000);
          connectInput();
        }, inputBackoff);
      };

      inputWs.onerror = () => {
        // Browser logs one red network error here — unavoidable, but it only
        // fires once per attempt (not in a tight loop) because onclose schedules
        // the next attempt with a backoff delay.
        setInput('unavailable', 'err');
      };
    }

    inputBtn.addEventListener('click', () => {
      inputBackoff = 1000; // reset backoff on manual retry
      connectInput();
    });

    // Auto-connect immediately on page load
    connectInput();

    function sendInput(msg) {
      if (inputWs && inputWs.readyState === WebSocket.OPEN) {
        inputWs.send(JSON.stringify(msg));
      }
    }

    // ── Input mode toggle ─────────────────────────────────────────────────────
    // KEYBOARD mode: every key is translated to a C64 matrix key event.
    // JOYSTICK mode: arrow keys + Z (fire) + X (fire alt) → joystick port 2
    //                events; all other keys still pass through as C64 keys.
    //
    // Joystick bitmask (matches input-server.mjs protocol):
    //   up=0x1  down=0x2  left=0x4  right=0x8  fire=0x10
    const modeBtn = document.getElementById('mode-btn');
    let joystickMode = false;

    // Keys that drive the joystick in joystick mode
    const JOY_MAP = {
      ArrowUp:    { direction: 'up' },
      ArrowDown:  { direction: 'down' },
      ArrowLeft:  { direction: 'left' },
      ArrowRight: { direction: 'right' },
      z:          { fire: true },
      Z:          { fire: true },
      x:          { fire: true },   // alternative fire
      X:          { fire: true },
    };

    modeBtn.addEventListener('click', () => {
      joystickMode = !joystickMode;
      if (joystickMode) {
        modeBtn.textContent = '🕹 joystick';
        modeBtn.classList.add('joystick');
      } else {
        modeBtn.textContent = '⌨ keyboard';
        modeBtn.classList.remove('joystick');
      }
    });

    // Keyboard → emulator
    // In keyboard mode: send e.key string + shiftKey so the server can
    //   translate via c64-key-map.mjs (which maps to C64 matrix indices).
    // In joystick mode: arrow keys / Z → joystick port 2 events;
    //   all other keys still fall through as keyboard events.
    const PREVENT_DEFAULT_KEYS = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Tab']);

    document.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
      if (e.repeat) return;

      if (joystickMode && JOY_MAP[e.key]) {
        const j = JOY_MAP[e.key];
        sendInput({ type: 'joystick', joystickPort: 2, action: 'push',
                    direction: j.direction ?? undefined, fire: j.fire ?? false });
      } else {
        sendInput({ type: 'key', key: e.key, shiftKey: e.shiftKey, action: 'down' });
      }
    });

    document.addEventListener('keyup', (e) => {
      if (joystickMode && JOY_MAP[e.key]) {
        const j = JOY_MAP[e.key];
        sendInput({ type: 'joystick', joystickPort: 2, action: 'release',
                    direction: j.direction ?? undefined, fire: j.fire ?? false });
      } else {
        sendInput({ type: 'key', key: e.key, shiftKey: e.shiftKey, action: 'up' });
      }
    });

    // Click video to unmute audio (browser autoplay policy requires a user gesture)
    // After unmuting, wire an AudioContext analyser to detect actual signal and
    // update the audio badge from 'click for audio' → 'starting…' → '🔊 audio on'.
    videoEl.addEventListener('click', () => {
      if (videoEl.muted) {
        videoEl.muted = false;
        setAudio('starting…', 'warn');
        // AudioContext must be created/resumed inside a user gesture
        if (remoteStream) {
          startAudioMonitor(remoteStream);
        } else {
          // Stream not arrived yet — monitor will start on next click or when
          // stream arrives; watch for it.
          const waitForStream = setInterval(() => {
            if (remoteStream) {
              clearInterval(waitForStream);
              startAudioMonitor(remoteStream);
            }
          }, 500);
        }
      }
    });
  </script>
</body>
</html>`;
}

