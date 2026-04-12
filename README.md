[![C64 Ready Prompt](./public/c64-ready/c64-ready.gif)](https://hayesmaker.github.io/c64-ready/)

# c64-ready

`c64-ready` is a TypeScript/Vite frontend prototype for running and rendering a Commodore 64 emulator in the browser.

It is based on `c64.js (from lvllvl.com by James)` from the original project source: https://github.com/jaammees/lvllvl

## Goal

Build a clean, testable C64 emulator for the web, with a focus on:

- low-level WASM access,
- emulator control/state,
- canvas-based rendering
- node based headless rendering
- framework agnostic integration

### Live URL

https://hayesmaker.github.io/c64-ready/

## Install and run locally
- Prerequisites: Node.js 18+ and npm (see https://nodejs.org/)

Install dependencies:

```zsh
npm install
```

Start the dev server:

```zsh
npm run dev
```

Create a production build:

```zsh
npm run build
```

## Unit tests

This project uses Vitest with a jsdom environment (Jest-like API, faster integration with Vite/TypeScript).

Run tests:

```zsh
npm test
```

Run tests in watch mode:

```zsh
npm run test:watch
```

## Headless streaming (Docker)

The headless player streams the C64 output over **WebRTC** — a single container serves
a self-contained browser player page with sub-100ms latency and a built-in keyboard/
joystick input channel. No separate media server is required.

**Prerequisites:** Docker and Docker Compose v2.

### Quick start

#### With NPM

```bash
npx c64-ready```
```
This starts a static server that serves the browser player on `http://localhost:5173/c64-ready/` by default.

#### With Docker

```zsh
# 1. Copy the env file and edit to taste (defaults: BASIC prompt, WebRTC on :9002)
cp docker/.env.example docker/.env

# 2. Build and start
docker compose up --build

# 3. Open the player in a browser
open http://localhost:9002
```

The player page is self-contained — video, audio, and keyboard/joystick input are all
handled in the browser with no extra software needed.

### Load a cartridge

Games are bind-mounted from `public/games/` — no rebuild needed:

```zsh
# Set GAME_PATH in docker/.env, then restart
docker compose restart headless

# Or override inline for a one-off run
GAME_PATH=/app/public/games/cartridges/legend-of-wilf.crt docker compose up
```

You can also drag-and-drop game files onto the player page at any time to load without
restarting the container. Supported browser-side formats are `.crt`, `.prg`, `.d64`,
and native snapshots (`.c64`, `.snapshot`, `.s64`).

Note: VICE `.vsf` snapshots are currently disabled in the browser runtime.

### Keyboard limitations (current WASM build)

- The C64 `RESTORE` key is currently not functional in this build.
- We verified browser key mapping for `Page Up` is received, but the underlying
  WASM core does not appear to trigger restore behavior from key input.
- Treat this as a runtime limitation of the shipped binary for now.

### Environment variables

All options live in `docker/.env` (copy from `docker/.env.example`). See that file for
the full annotated list.

| Variable | Default | Description |
|----------|---------|-------------|
| `WASM_PATH` | `/app/public/c64.wasm` | Path to the WASM binary inside the container |
| `GAME_PATH` | *(empty)* | Cartridge to load on startup — leave blank to boot to BASIC |
| `FPS` | `50` | Target frame rate (`50` = PAL, `60` = NTSC) |
| `AUDIO` | `1` | Set to `1` to include SID audio in the WebRTC stream |
| `DURATION` | *(empty = forever)* | Stop after this many seconds |
| `VERBOSE` | *(empty)* | Set to `1` for per-frame diagnostics in container logs |
| `LOG_EVENTS` | `1` | Log player joins/leaves, cart loads, input events |
| `WEBRTC_ENABLED` | `1` | Must be `1` — WebRTC is the only supported streaming mode |
| `WEBRTC_PORT` | `9002` | Port inside the container for the WebRTC server |
| `WEBRTC_HOST_PORT` | `9002` | Host-side port mapping for the WebRTC server |
| `MAX_SPECTATORS` | `3` | Max concurrent spectator connections (players are separate, see below) |
| `WEBRTC_MIN_BITRATE_KBPS` | `200` | VP8 SDP `x-google-min-bitrate` hint in kbps |
| `WEBRTC_MAX_BITRATE_KBPS` | `600` | VP8 SDP `x-google-max-bitrate` hint in kbps |
| `WEBRTC_OUTPUT_FPS` | `40` | Cap outgoing WebRTC video FPS (`0` disables cap) |
| `C64_ADMIN_TOKEN` | *(empty)* | Shared token required by `c64-admin` (`status`, `kick`) |
| `WS_PORT` | `9001` | WebSocket input server port inside the container |
| `WS_HOST_PORT` | `9001` | Host-side port mapping for the input WebSocket |

### Admin CLI

Use `c64-admin` to inspect active players/spectators and run admin actions over the input WebSocket:

```zsh
# show current room/client state
c64-admin --token "$C64_ADMIN_TOKEN" status

# kick a specific player slot
c64-admin --token "$C64_ADMIN_TOKEN" kick --player host

# kick all clients and disconnect all WebRTC peers
c64-admin --token "$C64_ADMIN_TOKEN" kick --all
```

#### Spectator limit

Up to **2 player slots** (host + P2) are always reserved. `MAX_SPECTATORS` controls how
many additional viewers can connect simultaneously. Total WebRTC peers = `MAX_SPECTATORS + 2`.
Connections beyond the limit receive a `capacity-full` message and are rejected immediately.

### FFmpeg recording / capture

FFmpeg can be used alongside the WebRTC stream for local recording or debugging. Pass
`--record` to the CLI to enable it — both modes run concurrently:

```zsh
# Record a 60-second session to a file (no Docker needed)
node bin/headless.mjs --wasm public/c64.wasm --no-game \
  --record --output out.mp4 --duration 60

# WebRTC stream + simultaneous local recording
node bin/headless.mjs --wasm public/c64.wasm --game public/games/cartridges/game.crt \
  --webrtc --webrtc-port 9002 \
  --record --output recording.mp4 \
  --input --ws-port 9001 --fps 50

# Push to an RTMP endpoint (e.g. for OBS / Twitch ingest)
node bin/headless.mjs --wasm public/c64.wasm --no-game \
  --record --output rtmp://localhost:1935/live/c64
```

`ffmpeg` must be on `PATH` for `--record` to work.

### Stop

```zsh
docker compose down
```

## Headless Input API

When the headless emulator is started with `--input` (or `INPUT_ENABLED=1` in Docker), it opens a **WebSocket server** on port `9001` (configurable via `--ws-port` / `WS_PORT`).

Any client — browser, Node script, or bot — can connect and send JSON messages to control the emulator in real-time.

### Connection & handshake

On connect the server immediately sends a `hello` frame:

```json
{
  "type": "hello",
  "protocol": "c64-input",
  "version": 1,
  "joystickBitmask": { "up": 1, "down": 2, "left": 4, "right": 8, "fire": 16 }
}
```

### Wire protocol (client → server)

**Joystick** — the emulator holds the direction for exactly as long as the client holds it.
A `release` **must** be sent explicitly when the physical (or virtual) button is lifted.
Never infer release from a timer — if the release message is not sent the direction will stick indefinitely.

```json
{ "type": "joystick", "action": "push",    "joystickPort": 2, "direction": "up" }
{ "type": "joystick", "action": "release", "joystickPort": 2, "direction": "up" }

{ "type": "joystick", "action": "push",    "joystickPort": 2, "fire": true }
{ "type": "joystick", "action": "release", "joystickPort": 2, "fire": true }
```

**Keyboard** — use the C64 key code (integer):

```json
{ "type": "key", "action": "down", "key": 65 }
{ "type": "key", "action": "up",   "key": 65 }
```

### Client example — Node.js

A minimal Node.js client that connects, waits for the handshake, then mirrors `keydown` / `keyup`-style events from the calling code as explicit `push` / `release` pairs:

```js
import { WebSocket } from 'ws'; // npm install ws

const ws = new WebSocket('ws://localhost:9001');
let ready = false;

// --- helpers ---------------------------------------------------------

function joystickPush(port, direction, fire) {
  if (!ready) return;
  ws.send(JSON.stringify({ type: 'joystick', action: 'push', joystickPort: port, direction, fire }));
}

function joystickRelease(port, direction, fire) {
  if (!ready) return;
  ws.send(JSON.stringify({ type: 'joystick', action: 'release', joystickPort: port, direction, fire }));
}

// --- lifecycle -------------------------------------------------------

ws.on('open', () => console.log('connected'));

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type !== 'hello') return;
  console.log('server ready, protocol version', msg.version);
  ready = true;
});

ws.on('close', () => console.log('disconnected'));
ws.on('error', (err) => console.error('ws error:', err.message));

// --- usage -----------------------------------------------------------
// Drive push/release from your own input events, e.g.:
//
//   gamepad 'buttondown' event fires  → joystickPush(2, 'up')
//   gamepad 'buttonup'   event fires  → joystickRelease(2, 'up')
//
// Example: a simple readline-driven test sequence
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [action, direction] = line.trim().split(' ');
  if (action === 'push')    joystickPush(2, direction);
  if (action === 'release') joystickRelease(2, direction);
  if (action === 'quit')    ws.close();
});
```

Run it and type `push up` / `release up` to move the joystick while the emulator is streaming.

### Client example — Browser

The browser's built-in `WebSocket` works the same way — useful for a frontend that streams video via flv.js and sends keyboard/joystick input back:

```js
const ws = new WebSocket('ws://localhost:9001');

ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type !== 'hello') return;
  console.log('c64-input server ready');
});

// Map keyboard events → C64 key codes and send them
document.addEventListener('keydown', (evt) => {
  ws.send(JSON.stringify({ type: 'key', action: 'down', key: evt.keyCode }));
});
document.addEventListener('keyup', (evt) => {
  ws.send(JSON.stringify({ type: 'key', action: 'up', key: evt.keyCode }));
});
```

### Using `InputBridge` helpers (TypeScript / ESM)

`InputBridge` ships static encoder helpers so you don't have to hand-roll JSON strings:

```ts
import { InputBridge } from 'c64-ready/src/headless/input-bridge';

// Encode a joystick push and release
const push    = InputBridge.encodeJoystick(2, 'push',    'right');
const release = InputBridge.encodeJoystick(2, 'release', 'right');

// Encode fire button
const firePush    = InputBridge.encodeJoystick(2, 'push',    undefined, true);
const fireRelease = InputBridge.encodeJoystick(2, 'release', undefined, true);

// Encode a keypress
const keyDown = InputBridge.encodeKeypress(65, 'down'); // 'A'
const keyUp   = InputBridge.encodeKeypress(65, 'up');

// Send push on button-down, release on button-up — never infer release from a timer
gamepad.on('buttondown', (btn) => ws.send(InputBridge.encodeJoystick(2, 'push',    btn.direction)));
gamepad.on('buttonup',   (btn) => ws.send(InputBridge.encodeJoystick(2, 'release', btn.direction)));
```

### Docker — enabling input

Expose the WebSocket port and set `INPUT_ENABLED=1` in `docker/.env` (or inline):

```zsh
INPUT_ENABLED=1 WS_PORT=9001 docker compose up
```

Then connect your client to `ws://localhost:9001`.

## Using c64-ready as an npm package

`c64-ready` can be installed as a dependency and used in three ways:

| Use-case | How |
|---|---|
| Run the browser player locally | `npx c64-ready` (zero config) |
| TypeScript / Node API | `import` from sub-path exports |
| Vite browser app | Copy or re-use `src/player/*` with your own Vite project |

### Prerequisites

The TypeScript compiled outputs (`dist-ts/`) must be present in the package. They are
generated by `npm run package:build` (`npm run build && npm run headless:build`) before
publishing. A published release on npm will always contain them.

### Running the browser player

After installing the package globally, or via `npx`, the `c64-ready` command starts a
lightweight static HTTP server that serves the pre-built browser player:

```zsh
# Run without installing (npx caches the package automatically)
npx c64-ready

# Or install globally and run
npm install -g c64-ready
c64-ready
```

Open the URL printed to the terminal in any modern browser:

```
  C64 Ready player is running.

  ➜  Local:   http://localhost:5173/c64-ready/
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--port <n>` | `5173` | HTTP port to listen on |
| `--host` | localhost | Bind to `0.0.0.0` so the player is reachable on the local network |
| `--help` | | Print usage |

```zsh
# Different port, accessible on the LAN
c64-ready --port 8080 --host
```

> **Note:** `c64-ready` serves the compiled `dist/` directory. If you are working from a
> cloned repo rather than a published package, run `npm run build` first.

### TypeScript / Node.js API

After installing as a local dependency:

```zsh
npm install c64-ready
```

The following sub-path exports are available:

#### Shared types — `c64-ready`

```ts
import type { C64Config, FrameBuffer, AudioBuffer, InputEvent, GameLoadOptions } from 'c64-ready';
```

#### Low-level emulator — `c64-ready/emulator`

`C64Emulator` is the single class all higher-level consumers build on. It owns the WASM
lifecycle and fires `onFrame` / `onAudio` callbacks each tick.

```ts
import { C64Emulator } from 'c64-ready/emulator';

// Load and initialise the WASM binary
const emulator = await C64Emulator.load('/path/to/c64.wasm');

// React to each rendered frame (RGBA pixels, 384 × 272)
emulator.onFrame = (frame) => {
  console.log(`frame ${frame.timestamp}: ${frame.width}×${frame.height}`);
};

// Load a cartridge (.crt file bytes)
const crtBytes = new Uint8Array(await fetch('/games/mygame.crt').then(r => r.arrayBuffer()));
emulator.loadGame({ type: 'crt', data: crtBytes });

// Start the emulation loop
emulator.start();
```

#### Headless emulator — `c64-ready/headless`

`C64Headless` wraps `C64Emulator` for server-side use (Node.js / Deno). It wires up
`FrameCapture`, `AudioCapture`, and `InputBridge` out of the box.

```ts
import { C64Headless } from 'c64-ready/headless';

const headless = new C64Headless('/path/to/c64.wasm');
await headless.init();

// Optional: load a game
const data = new Uint8Array(fs.readFileSync('/path/to/game.crt'));
await headless.loadGame({ type: 'crt', data });

// Step the emulator and capture frames
const { frame, audio } = headless.stepAndCapture(20); // 20 ms step
if (frame) {
  // frame is a Uint8Array of raw RGBA pixels (384 × 272)
}

// Forward remote input from an external source (e.g. WebSocket message)
headless.inputBridge.receiveRemoteInput(
  JSON.stringify({ type: 'joystick', action: 'push', joystickPort: 2, direction: 'up' })
);
```

#### Remote input encoding — `c64-ready/input-bridge`

`InputBridge` provides static helpers so you don't hand-roll input JSON:

```ts
import { InputBridge } from 'c64-ready/input-bridge';

// Joystick
const push    = InputBridge.encodeJoystick(2, 'push',    'right');
const release = InputBridge.encodeJoystick(2, 'release', 'right');
const fire    = InputBridge.encodeJoystick(2, 'push',    undefined, true);

// Keyboard (C64 key code)
const keyDown = InputBridge.encodeKeypress(65, 'down'); // key code 65 = 'A'
const keyUp   = InputBridge.encodeKeypress(65, 'up');

// Send via WebSocket — push on button-down, release on button-up
gamepad.on('buttondown', (btn) => ws.send(InputBridge.encodeJoystick(2, 'push',    btn.direction)));
gamepad.on('buttonup',   (btn) => ws.send(InputBridge.encodeJoystick(2, 'release', btn.direction)));
```

### Using the player in your own Vite app

The browser player (`src/player/*`) uses Vite-specific features (`?raw` CSS imports,
`import.meta.env`) so it is **not** pre-compiled and is shipped as TypeScript source.
Copy the files you need into your own Vite project and import them directly:

```ts
// In your Vite project (TypeScript + Vite)
import { C64Player }     from './vendor/c64-ready/src/player/c64-player';
import CanvasRenderer    from './vendor/c64-ready/src/player/canvas-renderer';
import { AudioEngine }   from './vendor/c64-ready/src/player/audio-engine';

const renderer = new CanvasRenderer('c64-canvas');
const player   = new C64Player({
  wasmUrl:  '/c64.wasm',
  gameUrl:  '/games/mygame.crt',
  renderer,
});

await player.start();
```

Also copy `public/c64.wasm` and `public/audio-worklet-processor.js` into your project's
public directory so they are served alongside your app.

### Building before publish

To regenerate both the Vite browser bundle and the TypeScript API outputs in one step:

```zsh
npm run package:build
# equivalent to: npm run build && npm run headless:build
```

This produces:
- `dist/` — Vite browser bundle (served by `c64-ready` CLI)
- `dist-ts/` — compiled JS + `.d.ts` declarations (imported by API consumers)

## Deployment

The project deploys to GitHub Pages automatically via GitHub Actions.

On every push to `master`:
1. Tests run (`npm test`)
2. If tests pass, a production build is created (`npm run build`)
3. The `dist/` output is deployed to GitHub Pages


## Work in Progress:
- Proof of Concept Implementation:
- [x] WASM module loading and initialization
- [x] Emulator control and state management
- [x] Canvas-based rendering
- [x] Node-based headless rendering
- [x] Framework agnostic integration (e.g., Vanilla HTML+JS, React, Vue, Angular etc)
- Additional features:
- [x] Audio output
- [x] Input handling (keyboard)
- [x] Loading and running .crt cartridge roms
- [x] Display settings
- [x] Docker headless streaming (RTMP / HTTP-FLV via Node Media Server)
- [ ] Gamepad support
- [ ] Touch controls
- [ ] Mobile Layout
- [x] Loading more game formats (e.g., .d64 disk images)
- [ ] Performance optimizations (e.g., offscreen canvas, audio worklets)
- [ ] Jitter creep - frame timing optimizations for smoother rendering

## Changelog & Releases

See [`docs/CHANGELOG_RELEASES.md`](docs/CHANGELOG_RELEASES.md) for the full release workflow,
changelog generator usage, `tools/release.sh` examples, and authentication notes.

Quick start — bump and push a patch release:

```zsh
npm version patch -m "chore(release): %s"
git push origin master && git push --tags
```

## Docs

Extended documentation lives in the [`docs/`](docs/) folder:

| File | Description |
|------|-------------|
| [`AUDIO_ENGINE.md`](docs/AUDIO_ENGINE.md) | SID audio pipeline, worklet pull-model, timing rules |
| [`HEADLESS_INPUT.md`](docs/HEADLESS_INPUT.md) | Headless WebSocket input API reference |
| [`HEADLESS_RUNNING.md`](docs/HEADLESS_RUNNING.md) | Headless CLI usage, frame/timing rules, ffmpeg integration |
| [`PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md) | High-level architecture and design decisions |
| [`CHANGELOG_RELEASES.md`](docs/CHANGELOG_RELEASES.md) | Release workflow, `tools/release.sh`, changelog generator |
| [`WIKI_PUBLISHING.md`](docs/WIKI_PUBLISHING.md) | How to sync `docs/` to the GitHub wiki via `tools/publish_wiki.sh` |

The wiki is kept in sync automatically by the `.github/workflows/publish_wiki.yml` CI workflow
on every push to `master`. To publish manually:

```bash
./tools/publish_wiki.sh git@github.com:YOUR_USER/c64-ready.wiki.git
```
