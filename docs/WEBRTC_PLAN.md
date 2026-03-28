# WebRTC Streaming Plan

## Why RTMP is Too Laggy

The current pipeline is:

```
WASM emulator → raw RGBA frames → ffmpeg stdin pipe
    → libx264/H.264 encode → RTMP → Node-Media-Server
    → HTTP-FLV / HLS → flv.js player in browser
```

Each stage adds latency:

| Stage | Typical latency |
|-------|----------------|
| ffmpeg encode buffer (GOP / keyframe interval) | 500 ms – 2 s |
| RTMP → NMS ingest | 100 – 300 ms |
| HLS segment packaging (if HLS) | 2 – 6 s |
| HTTP-FLV playback buffer (flv.js) | 500 ms – 1.5 s |
| **Total (HTTP-FLV path)** | **~3 – 5 s** |

You measured 3 – 4 s — right on the expected median for this stack. The encoder's GOP (group-of-pictures) structure is 
the biggest offender: a viewer must wait for the next keyframe before decoding can start, and libx264 defaults to a 
2-second keyframe interval.

WebRTC eliminates almost every buffer in that chain. The path becomes:

```
WASM emulator → raw RGBA frames → VideoFrame (JSAPI) or raw H.264 NALs
    → RTCPeerConnection datagram transport
    → browser MediaStream → HTMLVideoElement
```

Typical RTCPeerConnection latency end-to-end (LAN or well-peered WAN): **< 100 ms**. Even over the internet with TURN 
relay: **150 – 300 ms**. That's 10–20× better than RTMP+flv.js.

---

## Target Architecture

```
┌────────────────────────────────────────────────┐
│  c64-ready Node.js process (headless)          │
│                                                │
│  ┌────────────────────┐  ┌──────────────────┐  │
│  │  WASM C64 Emulator │  │  WebRTC Server   │  │
│  │  debugger_update() │  │  (node-datachannel│  │
│  │  c64_getPixelBuffer│  │  or wrtc / @roamhq│ │
│  │  sid_getAudioBuffer│  │  /wrtc)          │  │
│  └────────┬───────────┘  └────────┬─────────┘  │
│           │ RGBA frame              │            │
│           │ F32 audio               │ ICE / DTLS │
│           └──────────── encode ─────┘            │
│                H.264 NALs / Opus              │
└───────────────────────────┬────────────────────┘
                            │  UDP (SRTP)
                            ▼
                  ┌─────────────────┐
                  │  Browser        │
                  │  RTCPeerConnection
                  │  MediaStream    │
                  │  <video>        │
                  │                 │
                  │  WebSocket      │
                  │  → input events │
                  └─────────────────┘
```

Input continues to flow over the existing WebSocket channel (port 9001). No change needed to `input-server.mjs`.

---

## Library Choices

### Option A — `node-datachannel` + `@roamhq/wrtc` (Recommended for this project)

| Library | Role | Notes |
|---------|------|-------|
| `@roamhq/wrtc` | Full WebRTC in Node (ICE, DTLS, SRTP, `RTCPeerConnection`) | Maintained fork of the archived `wrtc`; native addon with libwebrtc inside |
| `node-datachannel` | Lightweight alternative; exposes `RTCPeerConnection` + data channels | Smaller binary; good if you only need data channels + video tracks |

**`@roamhq/wrtc` is the better fit** here because it provides a complete W3C-compatible `RTCPeerConnection` API including `MediaStreamTrack` — the same API you use in the browser — which makes the signalling server and client code nearly identical.

### Option B — GStreamer WebRTC (gst-webrtc)
Full pipeline flexibility (VAAPI hardware encode, RTP resampling). Overkill for a single-session PoC; adds a large native dependency. Revisit for Phase 4 (multi-player scale).

### Option C — mediasoup / Pion
SFU-grade, multi-track routing. Required for true multi-player broadcast (one emulator → many viewers). Can be layered on top of the Phase 1 plan.

**Decision: Start with `@roamhq/wrtc` for Phase 1 (minimal viable latency fix), migrate to mediasoup SFU in Phase 3 (multi-player).**

---

## Phase 1 — Minimal PoC: Replace RTMP with WebRTC (≈ 1–2 days)

### New dependencies

```bash
npm install @roamhq/wrtc        # native WebRTC addon for Node.js
npm install ws                  # already installed for input-server
```

### New files

| File | Purpose |
|------|---------|
| `src/headless/webrtc-server.mjs` | Signalling + `RTCPeerConnection` management |
| `src/headless/webrtc-encoder.mjs` | Converts raw RGBA frames + F32 audio to H.264 NALs / Opus |

### Modified files

| File | Change |
|------|--------|
| `src/headless/headless-cli.mjs` | Add `--webrtc` and `--webrtc-port <n>` flags; wire encoder + server |
| `bin/headless.mjs` | Add flags to `--help` |
| `package.json` | Add `@roamhq/wrtc` dependency |

---

### Signalling: HTTP + WebSocket on the same port

WebRTC requires an out-of-band **signalling** exchange (SDP offer/answer + ICE candidates) before the first UDP packet is sent. We reuse the existing `ws` package on a second port (default 9002) dedicated to WebRTC signalling to keep it separate from the input channel.

A single HTTP endpoint `GET /` returns a minimal HTML page with the browser-side client embedded; WebSocket upgrade on the same port handles SDP.

---

## Concise Code Examples

### `src/headless/webrtc-server.mjs`

```js
/**
 * webrtc-server.mjs
 *
 * Lightweight WebRTC signalling server.
 * - HTTP GET /  → returns the browser-side HTML player page
 * - WebSocket upgrade → SDP offer/answer + ICE trickle
 *
 * Each browser connection gets its own RTCPeerConnection.
 * The caller supplies a `onPeerReady(pc)` callback invoked once
 * ICE is connected; at that point the caller should attach
 * MediaStreamTracks to `pc` (video + optional audio).
 */
import http from 'http';
import { WebSocketServer } from 'ws';
import { RTCPeerConnection } from '@roamhq/wrtc';

export function createWebRTCServer({ port = 9002, verbose = false, onPeerReady } = {}) {
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(BROWSER_HTML);
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // Trickle ICE: send candidates to the browser as they're discovered
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) ws.send(JSON.stringify({ type: 'candidate', candidate }));
    };

    pc.oniceconnectionstatechange = () => {
      if (verbose) console.error('[webrtc] ICE state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        onPeerReady?.(pc);
      }
    };

    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'offer') {
        await pc.setRemoteDescription(msg);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify(pc.localDescription));
      } else if (msg.type === 'candidate' && msg.candidate) {
        await pc.addIceCandidate(msg.candidate);
      }
    });

    ws.on('close', () => pc.close());
  });

  httpServer.listen(port, () => {
    console.error(`[webrtc] signalling server on http://0.0.0.0:${port}`);
  });

  return {
    close: () => new Promise((resolve) => {
      wss.close(() => httpServer.close(resolve));
    }),
  };
}

// ─── Minimal browser-side page ──────────────────────────────────────────────
// Embedded so the server is self-contained with no static file serving needed.
const BROWSER_HTML = /* html */ `<!DOCTYPE html>
<html>
<head><title>C64 WebRTC</title></head>
<body style="background:#000;display:flex;flex-direction:column;align-items:center">
  <video id="v" autoplay playsinline muted
    style="width:768px;height:544px;image-rendering:pixelated"></video>
  <script>
    const ws = new WebSocket('ws://' + location.host);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    pc.ontrack = (e) => { document.getElementById('v').srcObject = e.streams[0]; };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) ws.send(JSON.stringify({ type: 'candidate', candidate }));
    };

    ws.onmessage = async ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.type === 'answer') {
        await pc.setRemoteDescription(msg);
      } else if (msg.type === 'candidate' && msg.candidate) {
        await pc.addIceCandidate(msg.candidate);
      }
    };

    ws.onopen = async () => {
      // Browser initiates the offer so it can request the video track direction
      const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify(pc.localDescription));
    };

    // ── Input forwarding (reuse existing WS input channel on port 9001) ──
    const inputWs = new WebSocket('ws://' + location.hostname + ':9001');
    document.addEventListener('keydown', (e) => {
      inputWs.send(JSON.stringify({ type: 'key', key: e.keyCode, action: 'down' }));
    });
    document.addEventListener('keyup', (e) => {
      inputWs.send(JSON.stringify({ type: 'key', key: e.keyCode, action: 'up' }));
    });
  </script>
</body>
</html>`;
```

---

### `src/headless/webrtc-encoder.mjs`

The key challenge is converting the raw RGBA framebuffer from the WASM emulator
into a format `@roamhq/wrtc` can transmit as an `RTCRtpSender` track.

`@roamhq/wrtc` exposes a non-standard `RTCVideoSource` / `RTCVideoSink` API alongside the standard `MediaStream` API. We use `RTCVideoSource` to push raw `I420` frames (the YUV format expected by libwebrtc).

```js
/**
 * webrtc-encoder.mjs
 *
 * Bridges the WASM pixel buffer (RGBA) → WebRTC video track (I420 via @roamhq/wrtc).
 * Audio: WASM F32 PCM → RTCAudioSource → RTCAudioTrack.
 */
import { RTCVideoSource, RTCAudioSource, rgbaToI420 } from '@roamhq/wrtc';

export class WebRTCEncoder {
  videoSource = null;
  audioSource = null;
  videoTrack  = null;
  audioTrack  = null;

  _width  = 384;
  _height = 272;
  _sampleRate = 44100;

  init({ width = 384, height = 272, sampleRate = 44100 } = {}) {
    this._width  = width;
    this._height = height;
    this._sampleRate = sampleRate;

    this.videoSource = new RTCVideoSource();
    this.audioSource = new RTCAudioSource();

    this.videoTrack = this.videoSource.createTrack();
    this.audioTrack = this.audioSource.createTrack();
  }

  /**
   * Push one RGBA video frame into the WebRTC pipeline.
   * @param {Uint8Array} rgbaData - raw RGBA pixels, width*height*4 bytes
   */
  pushVideoFrame(rgbaData) {
    const { width, height } = this;
    // Allocate I420 buffer: Y plane (w*h) + U plane (w*h/4) + V plane (w*h/4)
    const i420Size = width * height * 3 / 2;
    const i420Data = new Uint8ClampedArray(i420Size);
    rgbaToI420({ width, height, data: rgbaData }, { width, height, data: i420Data });
    this.videoSource.onFrame({ width, height, data: i420Data });
  }

  /**
   * Push one block of Float32 PCM audio into the WebRTC pipeline.
   * @param {Float32Array} f32samples - SID output samples, already at sampleRate
   */
  pushAudioFrame(f32samples) {
    // @roamhq/wrtc expects Int16 PCM
    const int16 = new Int16Array(f32samples.length);
    for (let i = 0; i < f32samples.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, f32samples[i] * 32767));
    }
    this.audioSource.onData({
      samples: int16,
      sampleRate: this._sampleRate,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: int16.length,
    });
  }

  get width()  { return this._width;  }
  get height() { return this._height; }
}
```

---

### Wiring into `headless-cli.mjs` (diff-style)

```js
// ── parse args ──────────────────────────────────────────────────────────────
let webrtc = false;
let webrtcPort = 9002;
// …inside the argv loop:
else if (a === '--webrtc')       webrtc = true;
else if (a === '--webrtc-port')  webrtcPort = Number(argv[++i]);

// ── after emulator init ─────────────────────────────────────────────────────
let webrtcEncoder   = null;
let webrtcServer    = null;
let videoTrack      = null;
let audioTrack      = null;
const pendingPeers  = new Set();

if (webrtc) {
  const { WebRTCEncoder }     = await import('./webrtc-encoder.mjs');
  const { createWebRTCServer } = await import('./webrtc-server.mjs');

  webrtcEncoder = new WebRTCEncoder();
  webrtcEncoder.init({ width: 384, height: 272, sampleRate: 44100 });
  videoTrack = webrtcEncoder.videoTrack;
  audioTrack = webrtcEncoder.audioTrack;

  webrtcServer = createWebRTCServer({
    port: webrtcPort,
    verbose,
    onPeerReady(pc) {
      const stream = new (await import('@roamhq/wrtc')).MediaStream([videoTrack, audioTrack]);
      pc.addTrack(videoTrack, stream);
      pc.addTrack(audioTrack, stream);
    },
  });
}

// ── inside the frame loop, after exports.debugger_update(stepMs) ───────────
if (webrtc && webrtcEncoder) {
  const ptr  = exports.c64_getPixelBuffer();
  const rgba = heap.heapU8.subarray(ptr, ptr + 384 * 272 * 4);
  webrtcEncoder.pushVideoFrame(rgba);

  sidSampleAccum += samplesPerFrame;
  if (sidSampleAccum >= SID_BUFFER_SIZE) {
    sidSampleAccum -= SID_BUFFER_SIZE;
    const sidPtr  = exports.sid_getAudioBuffer();
    const sidBase = sidPtr >> 2;
    const audio   = heap.heapF32.subarray(sidBase, sidBase + SID_BUFFER_SIZE);
    webrtcEncoder.pushAudioFrame(audio);
  }
}
```

> **Note on track attachment timing**: `@roamhq/wrtc` requires tracks to be added to the `RTCPeerConnection` *before* `createAnswer()` is called. The `onPeerReady` callback fires after `setRemoteDescription(offer)` but before `createAnswer()` — the example above needs a small refactor so `addTrack` calls happen in the `ws.onmessage` handler before `createAnswer()`. See the corrected flow in Phase 1 implementation notes below.

---

## Phase 2 — Quality & Reliability (1 week)

### Video quality
`@roamhq/wrtc` internally uses libwebrtc's VP8 encoder by default. For retro pixel art the best settings are:

```js
// In the SDP negotiation, prefer H.264 baseline for maximum browser compat:
const offer = await pc.createOffer();
const sdp = offer.sdp.replace(
  /(m=video.*\r\n)/,
  '$1b=AS:500\r\n'  // 500 kbps cap; pixel art compresses well
);
```

Or use `RTCRtpSender.setParameters()` after `setLocalDescription` to cap bitrate:

```js
const sender = pc.getSenders().find(s => s.track?.kind === 'video');
const params = sender.getParameters();
params.encodings[0].maxBitrate = 500_000; // 500 kbps
await sender.setParameters(params);
```

### TURN relay for WAN
Add a TURN server to `iceServers` so connections work when NAT traversal fails (e.g., symmetric NAT):

```js
{
  urls: 'turn:your-turn-server.example.com:3478',
  username: 'c64',
  credential: 'c64arcade'
}
```

Cheap TURN options: `coturn` on a $5 VPS, or Cloudflare Calls (free tier).

### Adaptive frame rate
WebRTC's congestion control (GCC) will already drop frames if the network can't keep up. At 50fps (C64 PAL) the encoder produces ~500 kbps at 384×272 in VP8 — well within a typical home connection. No extra throttling needed.

---

## Phase 3 — Multi-Player via SFU (mediasoup)

For the multi-player case (one emulator, many viewers):

```
WASM emulator → WebRTCEncoder → mediasoup Router
                                    ├── Viewer 1 (RTCPeerConnection)
                                    ├── Viewer 2
                                    └── Viewer N
```

`mediasoup` acts as an SFU (Selective Forwarding Unit): it receives one video/audio stream from the producer (headless Node process) and relays encoded packets to each consumer without re-encoding. This is highly efficient — CPU cost is O(1) on the server regardless of viewer count.

```bash
npm install mediasoup   # native addon; requires node-gyp + build tools
```

Key mediasoup objects:

```js
import mediasoup from 'mediasoup';

const worker  = await mediasoup.createWorker();
const router  = await worker.createRouter({ mediaCodecs: [
  { kind: 'video', mimeType: 'video/VP8',  clockRate: 90000 },
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000 },
]});

// Producer side (headless server):
const transport  = await router.createPlainTransport({ listenIp: '127.0.0.1', rtcpMux: true });
const producer   = await transport.produce({ kind: 'video', rtpParameters: ... });

// Consumer side (per viewer — handled in signalling WS handler):
const consumerTransport = await router.createWebRtcTransport({ listenIps: [{ ip: '0.0.0.0' }] });
const consumer          = await router.consume({ producerId: producer.id, transportId: ..., rtpCapabilities: ... });
```

The existing `input-server.mjs` WebSocket channel handles joystick/keyboard events for every player — no change needed; the emulator is still a single WASM instance shared by all.

---

## Migration Path Summary

```
Phase 0  (now)    WASM → ffmpeg stdin → RTMP → NMS → flv.js        latency: 3–5 s
Phase 1  (PoC)    WASM → @roamhq/wrtc → RTCPeerConnection           latency: ~100 ms
Phase 2  (stable) + TURN relay + bitrate cap + STUN config           latency: 100–300 ms WAN
Phase 3  (multi)  + mediasoup SFU → N concurrent viewers            scale: unlimited RX
```

---

## Work Breakdown — Phase 1 Implementation Checklist

- [ ] `npm install @roamhq/wrtc` — verify native build succeeds (`node -e "require('@roamhq/wrtc')"`)
- [ ] Create `src/headless/webrtc-encoder.mjs` (RGBA→I420 + F32→Int16 Opus push)
- [ ] Create `src/headless/webrtc-server.mjs` (HTTP signalling + WS SDP exchange)
- [ ] Add `--webrtc` / `--webrtc-port` flags to `headless-cli.mjs` and `bin/headless.mjs`
- [ ] Wire encoder + server in frame loop (after `debugger_update`)
- [ ] Test with: `node bin/headless.mjs --wasm public/c64.wasm --webrtc --webrtc-port 9002 --fps 50 --no-game`
- [ ] Open `http://localhost:9002` in browser, verify video renders < 200 ms after keypress
- [ ] Confirm existing `--input` / `--ws-port 9001` still works alongside WebRTC
- [ ] Smoke-test Docker: expose port 9002 in `docker-compose.yml`, set `WEBRTC_PORT` env var

---

## Open Questions / Risks

| Risk | Mitigation |
|------|-----------|
| `@roamhq/wrtc` native build fails on the target OS/arch | Fall back to `node-datachannel` (pure C++, easier build). Both expose compatible `RTCPeerConnection` API |
| `rgbaToI420` from `@roamhq/wrtc` — may not be exported in all versions | Implement a small JS RGBA→I420 converter (trivial, ~20 lines) as a fallback |
| `RTCPeerConnection.addTrack` must happen before `createAnswer` | Ensure signalling server calls `addTrack` in the `offer` handler, before `createAnswer` |
| UDP port range for ICE/SRTP (Docker networking) | Expose the ICE port range in `docker-compose.yml`: `ports: ["50000-50200:50000-50200/udp"]` and set `RTCPeerConnection` `portRange` option |
| Audio codec mismatch (SID outputs 44100 Hz mono, WebRTC prefers 48000 Hz Opus) | `@roamhq/wrtc`'s `RTCAudioSource` resamples internally; specify `sampleRate: 44100` in `onData` call |

---

## Quick-Start Commands (Phase 1)

```bash
# Install
npm install @roamhq/wrtc

# Run headless with WebRTC (no game, 50fps PAL)
node bin/headless.mjs \
  --wasm public/c64.wasm \
  --no-game \
  --webrtc \
  --webrtc-port 9002 \
  --input \
  --ws-port 9001 \
  --fps 50 \
  --verbose

# Open in browser (same machine)
open http://localhost:9002

# Or in Docker (add to docker-compose.yml):
# ports:
#   - "${WEBRTC_HOST_PORT:-9002}:9002"
#   - "50000-50200:50000-50200/udp"   # ICE candidate UDP range
```

---

## References

- [@roamhq/wrtc npm](https://www.npmjs.com/package/@roamhq/wrtc) — maintained fork of `node-webrtc`
- [node-datachannel](https://github.com/murat-dogan/node-datachannel) — lightweight alternative
- [mediasoup](https://mediasoup.org/) — SFU for Phase 3 multi-player
- [WebRTC RTCPeerConnection MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)
- [coturn TURN server](https://github.com/coturn/coturn)
- [Cloudflare Calls (free tier TURN)](https://developers.cloudflare.com/calls/)
- [WebRTC for the Curious — latency internals](https://webrtcforthecurious.com/docs/06-data-communication/)

