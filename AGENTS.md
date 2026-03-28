# AGENTS — How to be productive in this repo

This file captures the minimal, high-value knowledge an automated coding agent needs to work effectively in c64-ready.

Quick start
- Install + run dev server: `npm install && npm run dev`
- Build production + headless wrapper: `npm run build` and `npm run headless:build` (runs `npx tsc -p tsconfig.build.json`)
- Run headless CLI (no build required if you want the source shim):
```zsh
node bin/headless.mjs --wasm public/c64.wasm --no-game --frames 50
```

Big-picture architecture (what to read first)
- WASM loader / low-level: `src/emulator/c64-wasm.ts` — memory, imports, DYNAMICTOP_PTR/DYNAMIC_BASE, `allocAndWrite`, `updateHeapViews()`
- High-level emulator API: `src/emulator/c64-emulator.ts` — uses WASM exports, exposes `tick`/`start`/`loadGame`, frame/audio hooks
- Player/UI: `src/player/*` — `c64-player.ts`, `canvas-renderer.ts`, `audio-engine.ts`, `input-handler.ts`, `ui-controller.ts`
- Headless tooling: `src/headless/*` and CLI entry `bin/headless.mjs` — uses `src/headless/c64-wasm.mjs` shim or `dist-ts` fallback and `src/headless/headless-cli.mjs`
- Public assets: `public/c64.wasm` (WASM binary), `public/audio-worklet-processor.js` (audio thread)

Critical, project-specific patterns & gotchas
- Memory / heap lifecycle:
  - Always call `updateHeapViews()` after `memory.grow()` or after the wrapper's `malloc` before reading/writing heap views (see `C64WASM.allocAndWrite()` and `updateHeapViews()` in `src/emulator/c64-wasm.ts`).
  - `DYNAMICTOP_PTR` and `DYNAMIC_BASE` constants in `C64WASM` must match the compiled `.wasm` layout or malloc will break.

- WASM instantiation order:
  1. Create WebAssembly.Memory sized to `INITIAL_PAGES`
  2. Provide `env` imports and minimal `wasi_snapshot_preview1.fd_write`
  3. `WebAssembly.instantiate(...)` → set `exports`
  4. `updateHeapViews()` then set sbrk pointer (`DYNAMICTOP_PTR`) and call `__wasm_call_ctors()`
  5. Call runtime init exps (`c64_init()`, `sid_setSampleRate(...)`, `debugger_set_speed(...)`, `debugger_play()`)

- Frame / timing rules (headless + browser):
  - Drive the emulator by calling `debugger_update(stepMs)` exactly once per frame (stepMs ≈ 1000/targetFps). Do NOT call it multiple times per loop — this speeds the emulator.
  - Clamp large delta times (if using wall-clock) to avoid burst execution (see clamp to ~1000/targetFps in `HEADLESS_RUNNING.md` and `src/headless/headless-cli.mjs`).

- Audio rules:
  - Read SID audio buffer via `sid_getAudioBuffer()` and the heap F32 view — buffer is 4096 Float32 samples.
  - NEVER call `sid_dumpBuffer()` in the normal playback frame loop (it resets SID internal counters and causes runaway speed).
  - NEVER call `sid_getAudioBuffer()` per-frame in the headless loop — it has the SAME runaway-speed effect as `sid_dumpBuffer()`: it resets the SID's internal sample counter so the next `debugger_update` runs extra cycles to refill the buffer. It also takes ~5ms per call on top of that.
  - Correct headless pattern: call `sid_getAudioBuffer()` **once** at init to cache the pointer, then read the buffer each frame via `heap.heapF32.subarray(cachedBase, cachedBase + samplesPerFrame)` (zero-copy). See `src/headless/headless-cli.mjs` (`sidAudioBase`).
  - Use the worklet pull-model: worklet posts `'need-samples'`, main thread reads `sid_getAudioBuffer()` and posts Float32Array back (see `public/audio-worklet-processor.js` and `src/player/audio-engine.ts`). The worklet pull-model is fine because `sid_getAudioBuffer()` is called infrequently (pulled by the audio thread, not every video frame).
  - The SID buffer is **4096 samples** filled by `debugger_update` across multiple calls. `sid_getAudioBuffer()` must be called once per full 4096-sample fill — NOT once per video frame. At 50fps (882 samples/frame) this is every ~4.65 frames. Track accumulated samples and call once per boundary crossing, sending the full 4096-sample buffer. See `sidSampleAccum` / `SID_BUFFER_SIZE` in `src/headless/headless-cli.mjs`.

Headless / recording integration notes
- `bin/headless.mjs` is the user-facing CLI wrapper; it imports `src/headless/headless-cli.mjs`.
- The CLI prefers `src/headless/c64-wasm.mjs` (no TypeScript build) but will fall back to `dist-ts/emulator/c64-wasm.js` if present.
- FFmpeg is used for recording/streaming; `ffmpeg` must be on PATH. The headless runner resolves outputs: remote URLs (rtmp://...) are used verbatim, local paths are resolved relative to repo root.

WebRTC streaming (low-latency)
- New files: `src/headless/webrtc-encoder.mjs`, `src/headless/webrtc-server.mjs`, `src/headless/c64-key-map.mjs`
- Start with: `node bin/headless.mjs --wasm public/c64.wasm --webrtc --webrtc-port 9002 --input --ws-port 9001 --fps 50 --no-game`
- Open `http://localhost:9002` — self-contained player page, no flv.js or NMS needed.
- Docker: set `WEBRTC_ENABLED=1` in `docker/.env` → entrypoint auto-adds `--webrtc --input`. **All config must be in `docker/.env`** — do NOT add `environment:` block entries or they will override `env_file` values with empty strings.
- **Keyboard mapping**: `keyboard_keyPressed(n)` takes a **C64 matrix key index**, NOT a DOM keyCode. The browser page sends `e.key` (string) + `e.shiftKey`; `c64-key-map.mjs::domKeyToC64Actions()` translates to matrix index and handles shift side-effects (cursor up/left, F-key pairs, etc.). Never pass `e.keyCode` directly to the WASM.
- **WebRTC encoder gotchas**:
  - `rgbaToI420` checks `data.byteLength === width*height*4` — a WASM heap `subarray` fails this because `byteLength` = full heap size. Use a pre-allocated staging `Uint8ClampedArray` in `init()` and `set()` into it each frame.
  - `RTCAudioSource.onData` requires exactly `sampleRate/100` samples per call (441 @ 44100 Hz). Buffer SID output and drain in exact 441-sample chunks.
  - `@roamhq/wrtc` native threads keep the Node event loop alive — always call `process.exit(0)` at the end of `bin/headless.mjs`.
- **Streaming loop**: `isStreamingMode = record || webrtc` — both modes run indefinitely (`endTime = Infinity`) unless `--duration` is set. `--frames` is only respected in non-streaming test/verify runs.

Testing, linting and tooling
- Tests: `vitest` — run `npm test` or `npm run test:watch`. Look under `src/...*.test.ts` and compiled `dist-ts/...test.js` for examples.
- Lint/format: `npm run lint` / `npm run lint:fix` and `npm run format` (prettier)
- Build for headless consumers: `npm run headless:build` (produces `dist-ts/emulator/c64-wasm.js`)

Search & edit guidance for agents
- When changing WASM-related constants, search for `DYNAMICTOP_PTR`, `DYNAMIC_BASE`, and `INITIAL_PAGES` in `src/emulator/c64-wasm.ts` and `dist-ts` compiled copies to ensure parity.
- When modifying audio timing, update `src/player/audio-engine.ts`, `public/audio-worklet-processor.js`, and tests under `src/player/*.test.ts`.
- For headless fixes, run the headless CLI locally with `--verbose` and `--frames` small (e.g. 50) and use `--record` only when ffmpeg is known-good.

Where to look next (code reading priority)
1. `src/emulator/c64-wasm.ts` (WASM lifecyle)
2. `src/emulator/c64-emulator.ts` (emulator API and examples of reading pixel/audio buffers)
3. `src/player/*` (renderer + audio glue)
4. `src/headless/headless-cli.mjs` + `bin/headless.mjs` (command-line flows and recording)

Run the emulator in a browser using Dev Server
```zsh
npm install
npm run dev
```
- Open `http://localhost:5173` in a browser to see the emulator page (Requires fairly modern browser)

Run headless CLI with the source shim and small frames to reproduce logic quickly:
```zsh
node bin/headless.mjs --wasm public/c64.wasm --no-game --frames 30 --verbose
```

### Dockerised headless CLI (Linux/Mac, requires Docker):

Two-container setup defined in `docker-compose.yml`:
- **nms** — Node Media Server (`docker/Dockerfile.nms`, `docker/nms/server.mjs`): RTMP ingest on `:1935`, HTTP-FLV/HLS on `:8000`
- **headless** — Headless C64 player (`docker/Dockerfile.headless`, entrypoint: `docker/entrypoint.sh`): WebRTC player on `:9002` + input WS on `:9001` (WebRTC mode), or streams via ffmpeg → RTMP → nms (legacy mode)

```zsh
# First run — copy and edit env vars
cp docker/.env.example docker/.env

# ── WebRTC mode (low-latency, recommended) ────────────────────────────────
# Set WEBRTC_ENABLED=1 in docker/.env, then:
docker compose up --build headless
# Open http://localhost:9002 in a browser — video + keyboard input, ~0ms lag

# ── Legacy RTMP mode ──────────────────────────────────────────────────────
# Leave WEBRTC_ENABLED blank in docker/.env
docker compose up --build

# Watch RTMP stream in VLC / ffplay
ffplay rtmp://localhost:1935/live/c64
# or open http://localhost:8000/live/c64/index.m3u8 in a player

# Stop everything
docker compose down
```

Key env vars (see `docker/.env.example`): `WEBRTC_ENABLED`, `WEBRTC_PORT`, `WASM_PATH`, `GAME_PATH`, `RTMP_URL`, `FPS`, `DURATION`, `AUDIO`, `VERBOSE`, `WS_PORT`.
All config belongs in `docker/.env` — do not use shell env var overrides (they interact badly with `env_file`).

