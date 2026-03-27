# Headless Input API

## Architecture Overview

```
┌─────────────────────────┐         RTMP / HTTP-FLV          ┌──────────────────┐
│   c64-ready (headless)  │ ──── video + audio (ffmpeg) ───▶ │  Node Media      │
│                         │                                  │  Server (nms)    │
│  ┌───────────────────┐  │                                  └────────┬─────────┘
│  │ WASM Emulator     │  │                                           │
│  │  c64_joystick_*   │  │                                  HTTP-FLV / HLS
│  │  keyboard_key*    │  │                                           │
│  └────────▲──────────┘  │                                           ▼
│           │             │                                   ┌──────────────────┐
│  ┌────────┴──────────┐  │        WebSocket (JSON)           │  Frontend App    │
│  │ InputBridge       │◀─┼──────── input events ◀────────────│  (Vue / browser) │
│  └───────────────────┘  │        ws://host:9001             │                  │
│           ▲             │                                   │  - flv.js player │
│  ┌────────┴──────────┐  │                                   │  - keyboard →    │
│  │ Input Server (ws) │  │                                   │    WS messages   │
│  │ port 9001         │  │                                   └──────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

Video flows **out** via ffmpeg → RTMP → NMS → flv.js in the browser.
Input flows **back** via WebSocket → headless process → WASM emulator exports.

## New Dependency

| Package | Version | Why |
|---------|---------|-----|
| `ws`    | ^8.18.0 | Lightweight WebSocket server for Node.js (zero transitive deps). Node's built-in WebSocket API is client-only; `ws` provides `WebSocketServer`. |

Add to `dependencies` in `package.json`.

## Source Tree — Files to Create & Modify

### New Files

| File | Purpose |
|------|---------|
| `src/headless/input-server.mjs` | WebSocket server module. Accepts connections on a configurable port (default 9001). Parses incoming JSON messages as `InputEvent` objects and forwards them to a callback. Sends a `hello` handshake on connect with protocol version and joystick bitmask reference. |

### Modified Files

| File | Changes |
|------|---------|
| **`package.json`** | Add `ws` to `dependencies`. |
| **`src/types/index.ts`** | Extend `InputEvent` interface: add `action` field (`'push' \| 'release' \| 'down' \| 'up'`) so joystick release events work; add unified `fire` boolean alongside legacy `fire1`/`fire2`. |
| **`src/headless/input-bridge.ts`** | Update `encodeJoystick()` / `encodeKeypress()` static helpers to include the new `action` field. Optionally handle push/release dispatch logic here instead of raw in the CLI. |
| **`src/headless/headless-cli.mjs`** | Add `--input` and `--ws-port <n>` CLI flags. Import and start `input-server.mjs` after emulator init. Wire `onInput` callback to call WASM exports (`c64_joystick_push`, `c64_joystick_release`, `keyboard_keyPressed`, `keyboard_keyReleased`) directly. Shut down WebSocket server on exit. |
| **`bin/headless.mjs`** | Add `--input` and `--ws-port` to the `--help` text. |
| **`docker/entrypoint.sh`** | Forward `INPUT_ENABLED` and `WS_PORT` environment variables as `--input --ws-port` CLI args. |
| **`docker-compose.yml`** | Expose WebSocket port (`${WS_HOST_PORT:-9001}:9001`) on the `headless` service. Add `INPUT_ENABLED` and `WS_PORT` to `env_file` passthrough. |

## JSON Wire Protocol

### Client → Server

**Joystick events** (push + release are both required — without release, directions stick):

```json
{ "type": "joystick", "action": "push|release", "joystickPort": 2, "direction": "up|down|left|right" }
{ "type": "joystick", "action": "push|release", "joystickPort": 2, "fire": true }
```

**Keyboard events**:

```json
{ "type": "key", "action": "down|up", "key": 65 }
```

### Server → Client

**Hello handshake** (sent on connect):

```json
{ "type": "hello", "protocol": "c64-input", "version": 1, "joystickBitmask": { "up": 1, "down": 2, "left": 4, "right": 8, "fire": 16 } }
```

## Key Design Decisions

1. **Push + Release events are mandatory** — The WASM binary exposes separate `c64_joystick_push()` and `c64_joystick_release()` exports. The existing `InputEvent` type only had fire booleans with no action field, so joystick directions would stick permanently. The `action` field fixes this.

2. **Direct WASM export calls in headless-cli** — `headless-cli.mjs` operates at the raw WASM exports level (no `C64Emulator` instance). The WebSocket `onInput` callback maps directly to `c64_joystick_push`/`c64_joystick_release`/`keyboard_keyPressed`/`keyboard_keyReleased`. This avoids introducing a new `C64Emulator` dependency into the headless CLI path.

3. **Separate transport from protocol** — `input-server.mjs` handles WebSocket transport; `InputBridge` handles JSON parsing and protocol logic. This keeps the WebSocket server replaceable (e.g., with a Unix socket or HTTP endpoint) without changing the emulator wiring.

4. **No auth or rate-limiting in MVP** — Acceptable for trusted LAN / Docker environments. Production deployments should add origin validation and per-client rate limiting in `input-server.mjs`.

5. **Latency profile** — Input latency: WebSocket RTT (~1–5 ms LAN) + up to one frame interval (20 ms at 50 fps). Dominant latency is the RTMP video path (~1–3 s with HTTP-FLV). Switching to WebRTC for video would reduce this in a future phase.
