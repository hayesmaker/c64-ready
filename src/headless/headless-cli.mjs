import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';
import FFmpegRunner from './ffmpeg-runner.mjs';
import { domKeyToC64Actions } from './c64-key-map.mjs';

/**
 * Run headless emulator. Exported so tests can inject a fake WebAssembly.instantiate.
 * options: { argv?: string[], instantiateFn?: (wasmBinary, importObject) => Promise<{ instance }>, repoRoot?: string }
 */
export async function runHeadless(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const repoRoot = options.repoRoot ?? path.resolve(new URL('../../', import.meta.url).pathname);

  // parse args
  let wasmArg = null;
  let gameArg = null;
  let noGame = false;
  let verbose = false;
  let frames = 300;
  let fps = 60;
  let verify = false;
  let record = false;
  let audio = false;
  let raw = false;
  let output = null;
  let durationSec = 0; // 0 means no --duration was passed → stream forever when recording
  let enableInput = false;
  let wsPort = 9001;
  let webrtc = false;
  let webrtcPort = 9002;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wasm' || a === '-w') wasmArg = argv[++i];
    else if (a === '--game' || a === '-g') gameArg = argv[++i];
    else if (a === '--frames' || a === '-n') frames = Number(argv[++i]);
    else if (a === '--verify') verify = true;
    else if (a === '--record') record = true;
    else if (a === '--audio') audio = true;
    else if (a === '--raw') raw = true;
    else if (a === '--output' || a === '-o') output = argv[++i];
    else if (a === '--duration' || a === '-d') durationSec = Number(argv[++i]);
    else if (a === '--no-game') noGame = true;
    else if (a === '--verbose') verbose = true;
    else if (a === '--fps') fps = Number(argv[++i]);
    else if (a === '--input') enableInput = true;
    else if (a === '--ws-port') wsPort = Number(argv[++i]);
    else if (a === '--webrtc') webrtc = true;
    else if (a === '--webrtc-port') webrtcPort = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      return {ok: false, output: 'help'};
    }
  }

  const defaultWasmPaths = [
    path.join(repoRoot, 'public', 'c64.wasm'),
    path.join(repoRoot, 'src', 'emulator', 'c64.wasm'),
  ];
  const defaultGamePaths = [
    path.join(repoRoot, 'public', 'games', 'cartridges', 'legend-of-wilf.crt'),
  ];

  async function findFirstExisting(paths) {
    for (const p of paths) {
      try {
        await fs.access(p);
        return p;
      } catch (_) {
      }
    }
    return null;
  }

  let wasmPath = wasmArg;
  if (!wasmPath) {
    const found = await findFirstExisting(defaultWasmPaths);
    if (found) wasmPath = found;
  }
  if (!wasmPath) return {ok: false, err: 'no-wasm'};

  let gamePath = gameArg ?? null;
  // If the user requested no game, ensure we do not load any default cartridge
  // even if one exists on disk.
  if (noGame) {
    gamePath = null;
  } else if (!gamePath) {
    const found = await findFirstExisting(defaultGamePaths);
    if (found) gamePath = found;
  }

  const out = [];
  out.push(`Starting headless C64 using WASM: ${wasmPath}` + (gamePath ? ` game: ${gamePath}` : ''));

  const wasmBinary = await fs.readFile(wasmPath);
  // runtime state placeholders — hoisted so onCommand handler can access c64wasm
  let exports  = null;
  let heap     = null;
  let c64wasm  = null;   // ← hoisted: needed by onCommand for allocAndWrite
  let wrapperUsed = false;
  // SID audio constants — hoisted so the SID-cache block and the frame loop
  // both see them regardless of declaration order.
  const SID_BUFFER_SIZE = 4096;

  // If a test injected a fake instantiate function, prefer that path so
  // tests can run without the compiled wrapper. Provide a minimal import
  // object (memory) that the fake instantiate can use.
  const instantiateFn = options.instantiateFn;
  const wasmAb = wasmBinary.buffer.slice(
    wasmBinary.byteOffset,
    wasmBinary.byteOffset + wasmBinary.byteLength,
  );
  if (typeof instantiateFn === 'function') {
    try {
      const mem = new WebAssembly.Memory({initial: 256});
      const importObject = {env: {memory: mem}, wasi_snapshot_preview1: {}};
      const res = await instantiateFn(wasmAb, importObject);
      const inst = res && (res.instance ?? res);
      exports = inst.exports ?? inst;
      // ensure exports.memory exists so later code can read/write
      if (exports && !exports.memory) exports.memory = mem;
      if (exports && exports.memory) {
        const buf = exports.memory.buffer;
        heap = {heapU8: new Uint8Array(buf), heapF32: new Float32Array(buf), heapU32: new Uint32Array(buf)};
      }
      if (exports && typeof exports.c64_init === 'function') exports.c64_init();
      if (exports && typeof exports.sid_setSampleRate === 'function') exports.sid_setSampleRate(44100);
      if (exports && typeof exports.debugger_set_speed === 'function') exports.debugger_set_speed(100);
      if (exports && typeof exports.debugger_play === 'function') exports.debugger_play();
      wrapperUsed = true;
    } catch (e) {
      console.error('[headless] instantiateFn failed:', e && e.message ? e.message : e);
    }
  }

  // Prefer the minimal local wrapper shipped under src/headless so the
  // CLI can run without a compiled dist-ts. This keeps the runtime files
  // in the source tree (src/headless) and avoids postinstall scripts.
  try {
    let C64WASM = null;
    try {
      const localMod = await import(new URL('./c64-wasm.mjs', import.meta.url).href);
      C64WASM = localMod.C64WASM ?? localMod.default ?? null;
      if (C64WASM) console.error('[headless] using local C64WASM wrapper (src/headless)');
    } catch (e) {
      // ignore — will try fallback
    }

    if (!C64WASM) {
      // Fallback to compiled dist-ts if present
      try {
        const wasmModuleUrl = new URL('../../dist-ts/emulator/c64-wasm.js', import.meta.url).href;
        const wasmMod = await import(wasmModuleUrl);
        C64WASM = wasmMod.C64WASM ?? wasmMod.default ?? null;
        if (C64WASM) console.error('[headless] using C64WASM from dist-ts');
      } catch (e) {
        // final fallback failure — will be handled below
      }
    }

    if (!C64WASM) throw new Error('C64WASM wrapper not found (src/headless or dist-ts)');

    const wasmAb = wasmBinary.buffer.slice(
      wasmBinary.byteOffset,
      wasmBinary.byteOffset + wasmBinary.byteLength,
    );
    c64wasm = new C64WASM();   // assigns to outer let
    await c64wasm.instantiate(wasmAb);

    exports = c64wasm.exports;
    heap = c64wasm.heap;

    // Initialise emulator state — mirrors C64Emulator.init() + start()
    exports.c64_init();
    exports.sid_setSampleRate(44100);
    exports.debugger_set_speed(100); // 100 = full speed (1% would be near-frozen)
    exports.debugger_play();

    if (gamePath) {
      try {
        const gameData = await fs.readFile(gamePath);
        const ptr = c64wasm.allocAndWrite(new Uint8Array(gameData));
        c64wasm.updateHeapViews();
        heap = c64wasm.heap;
        exports.c64_loadCartridge(ptr, gameData.length);
        exports.free(ptr);
        exports.c64_reset();
        exports.debugger_set_speed(100);
        exports.debugger_play();
      } catch (e) {
        out.push(`Failed to load game: ${String(e)}`);
      }
    }

    wrapperUsed = true;
  } catch (e) {
    console.error('[headless] C64WASM wrapper failed to load:', e && e.message ? e.message : e);
  }
  if (!wrapperUsed) {
    out.push('ERROR: dist-ts wrapper failed to load — cannot run headless');
    console.error('[headless] FATAL: dist-ts wrapper unavailable. Run: npx tsc -p tsconfig.build2.json');
    return {ok: false, output: out};
  }


  // ── Input server (WebSocket) ──────────────────────────────────────────────
  // Start the embedded WebSocket input server when --input is passed.
  // Remote clients connect and send JSON InputEvent messages which are
  // forwarded directly to the WASM joystick/keyboard exports.
  let inputServer = null;
  if (enableInput) {
    try {
      const { createInputServer } = await import('./input-server.mjs');
      // Try to import the kick-token validator from the co-located c64cade server.
      // If it's not present (standalone c64-ready usage) fall back to no-op.
      // NOTE: The import path is computed at runtime (not a string literal) so
      // Vite/Vitest does NOT attempt to resolve/bundle it at transform time —
      // dynamic import of a non-literal string is left to the JS engine.
      let validateKickToken = () => null;
      try {
        const kickTokenRelPath = '../../c64cade/packages/server/utils/kick-tokens.js';
        const kickTokenUrl = new URL(kickTokenRelPath, import.meta.url).href;
        const kickTokens = await import(kickTokenUrl);
        validateKickToken = kickTokens.validateKickToken;
      } catch { /* standalone mode — admin kick not available */ }

      const dirMap = { up: 0x1, down: 0x2, left: 0x4, right: 0x8 };


      /** Flush all SID ring state after any emulator reset/cart-change.
       *  The WASM SID resets its internal write cursor on c64_reset(), so any
       *  samples still in the JS ring are from the old game and must be discarded.
       *  sidSampleAccum is also zeroed so the next pull aligns with the freshly
       *  restarted SID write cursor rather than inheriting stale offset. */
      function resetSidRing() {
        sidSampleAccum = 0;
        sidRingWrite   = 0;
        sidRingRead    = 0;
        sidRingCount   = 0;
        sidFrameBuf.fill(0);
      }

      inputServer = createInputServer({
        port: wsPort,
        verbose,
        validateKickToken,
        initialCartFilename: gamePath ? path.basename(gamePath) : null,
        onCommand: (cmd) => {
          if (!exports) return;
          try {
            if (cmd.type === 'load-crt') {
              // Decode base64 → Uint8Array immediately and release the large
              // base64 string from the cmd object as soon as possible so GC
              // can reclaim it during the subsequent async gap.
              const buf = Buffer.from(cmd.data, 'base64');
              // Slice to own ArrayBuffer — avoids aliasing Node's pooled Buffer
              // which could span a much larger backing store than the data alone.
              const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
              cmd.data = null; // release base64 string early
              const byteLen = arr.length;
              const filename = cmd.filename;
              // Defer the blocking WASM work (malloc + copy + cartridge parse)
              // via setImmediate so the event loop can drain any pending frame
              // writes / setTimeout callbacks before the synchronous WASM work
              // begins. This prevents the frame loop from stalling mid-write.
              // Return a Promise so input-server waits before broadcasting
              // cart-loaded — ensuring clients are told only after load succeeds.
              return new Promise((resolve, reject) => {
                setImmediate(() => {
                  try {
                    // c64_loadCartridge parses the cart and resets the machine
                    // internally — the explicit c64_reset() after it is redundant
                    // and costs another ~1250ms of event-loop blockage for nothing
                    // (verified: PC is identical with or without the second reset).
                    // removeCartridge first ensures no stale cart state during parse.
                    exports.c64_removeCartridge();
                    const ptr = c64wasm.allocAndWrite(arr);
                    c64wasm.updateHeapViews();
                    heap = c64wasm.heap;
                    exports.c64_loadCartridge(ptr, byteLen);
                    exports.free(ptr);
                    exports.debugger_set_speed(100);
                    exports.debugger_play();
                    resetSidRing();
                    if (webrtcEncoder) webrtcEncoder.resetVideoTimestamp();
                    if (verbose) console.error(`[headless] cart loaded: ${filename} (${byteLen} bytes)`);
                    resolve();
                  } catch (err) {
                    if (verbose) console.error('[headless] cart load (deferred) error:', err);
                    reject(err);
                  }
                });
              });
            } else if (cmd.type === 'detach-crt') {
              // Instant detach: same pattern as hard-reset.
              // removeCartridge (~0ms) + c64_reset no-cart (~110ms) — fast enough
              // to run inline without setImmediate deferral.
              // Return a Promise so input-server still awaits before broadcasting
              // cart-detached (keeps the protocol consistent with load-crt).
              if (typeof exports.c64_removeCartridge === 'function') {
                exports.c64_removeCartridge();
              }
              exports.c64_reset();
              exports.debugger_set_speed(100);
              exports.debugger_play();
              resetSidRing();
              if (webrtcEncoder) webrtcEncoder.resetVideoTimestamp();
              if (verbose) console.error('[headless] cart detached');
            } else if (cmd.type === 'hard-reset') {
              // Instant hard reset: detach cart and soft-reset the machine.
              // c64_removeCartridge() is ~0ms; c64_reset() with no cart is ~110ms
              // and runs synchronously inline — no setImmediate deferral needed
              // since there is no loadCartridge call to block the event loop.
              // The game is intentionally NOT reloaded: hard reset returns to
              // the BASIC prompt / blank screen, matching real C64 behaviour.
              exports.c64_removeCartridge();
              exports.c64_reset();
              resetSidRing();
              if (webrtcEncoder) webrtcEncoder.resetVideoTimestamp();
              if (verbose) console.error('[headless] hard reset');
            }
          } catch (err) {
            if (verbose) console.error('[headless] command error:', err);
          }
        },
        onInput: (event) => {
          if (!exports) return;
          try {
            if (event.type === 'joystick') {
              const port = ((event.joystickPort ?? 2) - 1);  // 1-based → 0-based
              const dir = event.direction ? (dirMap[event.direction] ?? 0) : 0;
              const fire = (event.fire || event.fire1) ? 0x10 : 0;

              if (event.action === 'release') {
                if (dir) exports.c64_joystick_release(port, dir);
                if (fire) exports.c64_joystick_release(port, fire);
              } else {
                // Default to push for backwards compat (action missing)
                if (dir) exports.c64_joystick_push(port, dir);
                if (fire) exports.c64_joystick_push(port, fire);
              }
            } else if (event.type === 'key') {
              // event.key is a DOM key string ('a', 'ArrowUp', 'Enter', …)
              // Translate to one or more C64 matrix key actions, including
              // shift side-effects for cursor keys, F-key pairs, etc.
              const domKey   = String(event.key ?? '');
              const shiftKey = !!event.shiftKey;
              const evType   = event.action === 'up' ? 'keyup' : 'keydown';
              const c64acts  = domKeyToC64Actions(domKey, shiftKey, evType);
              for (const act of c64acts) {
                if (act.action === 'press') {
                  exports.keyboard_keyPressed(act.key);
                } else {
                  exports.keyboard_keyReleased(act.key);
                }
              }
              if (verbose && c64acts.length > 0) {
                console.error(`[input] key ${evType} "${domKey}" → ${JSON.stringify(c64acts)}`);
              }
            }
          } catch (err) {
            if (verbose) console.error('[headless] input dispatch error:', err);
          }
        },
      });
      out.push(`Input server listening on ws://0.0.0.0:${wsPort}`);
    } catch (e) {
      console.error('[headless] Failed to start input server:', e && e.message ? e.message : e);
      out.push(`input-server-failed: ${String(e)}`);
    }
  }

  // ── WebRTC server (low-latency streaming, replaces RTMP+flv.js) ─────────
  // Started when --webrtc is passed. Opens an HTTP+WS signalling server on
  // webrtcPort (default 9002). Each connecting browser gets its own
  // RTCPeerConnection fed by the shared encoder tracks.
  let webrtcEncoder = null;
  let webrtcServer  = null;

  if (webrtc) {
    try {
      const { WebRTCEncoder }      = await import('./webrtc-encoder.mjs');
      const { createWebRTCServer } = await import('./webrtc-server.mjs');
      const wrtcLib = (await import('@roamhq/wrtc')).default;
      const { MediaStream } = wrtcLib;

      webrtcEncoder = new WebRTCEncoder();
      webrtcEncoder.init({ width: 384, height: 272, sampleRate: 44100 });

      const { videoTrack, audioTrack } = webrtcEncoder;

      webrtcServer = createWebRTCServer({
        port: webrtcPort,
        verbose,
        inputPort: wsPort,
        // onOffer fires BEFORE createAnswer() — the right place to addTrack()
        onOffer(pc) {
          const stream = new MediaStream([videoTrack, audioTrack]);
          pc.addTrack(videoTrack, stream);
          pc.addTrack(audioTrack, stream);
          if (verbose) console.error('[webrtc] tracks attached to peer');
        },
        onPeerConnected(pc) {
          if (verbose) console.error('[webrtc] peer ICE connected');
        },
      });

      out.push(`WebRTC player at http://0.0.0.0:${webrtcPort}/`);
    } catch (e) {
      console.error('[headless] Failed to start WebRTC server:', e && e.message ? e.message : e);
      out.push(`webrtc-server-failed: ${String(e)}`);
      webrtc = false;
    }
  }

  // Run state and timing
  let frameCount = 0;
  let ffmpegDied = false; // set to true if ffmpeg exits unexpectedly and we give up
  const targetFps = (typeof fps === 'number' && !Number.isNaN(fps) && fps > 0) ? fps : 60;
  // Now that targetFps is known, configure the WebRTC encoder's frame duration
  // so video timestamps are driven by frame count × frame duration (µs) rather
  // than wall clock — making loadCartridge blockages invisible to the receiver.
  if (webrtcEncoder) webrtcEncoder.setFps(targetFps);

  // ── Audio timing ──────────────────────────────────────────────────────────
  const audioSampleRate = 44100;
  const samplesPerFrame = Math.floor(audioSampleRate / targetFps); // 882 @ 50fps
  let audioInterval = null;

  // SID audio design — two-stage pipeline:
  //
  // Stage 1 (WASM → JS ring):
  //   Call sid_getAudioBuffer() exactly once per SID_BUFFER_SIZE samples of
  //   emulated audio (every ~4.65 video frames at 50fps). This is the ONLY
  //   safe call rate — calling it more often resets the SID's internal write
  //   counter and causes runaway emulation speed (per AGENTS.md).
  //   Each pull copies the full 4096-sample WASM buffer into a JS-side ring.
  //
  // Stage 2 (JS ring → ffmpeg/WebRTC):
  //   Every video frame, dequeue exactly samplesPerFrame samples from the JS
  //   ring into sidFrameBuf. Send that to ffmpeg/WebRTC every frame — no
  //   bursting, perfectly aligned with the video frame rate, no A/V drift.
  //   The ring provides the decoupling: WASM pushes in 4096-sample chunks,
  //   consumers pull in 882-sample chunks.
  //
  // Ring sizing: hold at least 2× SID_BUFFER_SIZE so one full WASM pull
  // never overflows while the consumer hasn't caught up yet.
  const SID_RING_SIZE  = SID_BUFFER_SIZE * 4;  // 16384 samples of headroom
  const sidRing        = new Float32Array(SID_RING_SIZE);
  let   sidRingWrite   = 0;   // next write position in sidRing
  let   sidRingRead    = 0;   // next read  position in sidRing
  let   sidRingCount   = 0;   // samples currently in the ring
  // Accumulator: how many emulated samples have passed since last WASM pull.
  let   sidSampleAccum = 0;
  // Single staging buffer for per-frame audio delivered to ffmpeg/WebRTC.
  const sidFrameBuf    = new Float32Array(samplesPerFrame);

  /** Pull one 4096-sample chunk from the WASM SID buffer into the JS ring. */
  function pullSidBuffer() {
    if (!exports || !heap || typeof exports.sid_getAudioBuffer !== 'function') return;
    try {
      const ptr     = exports.sid_getAudioBuffer();
      const base    = ptr >> 2;
      const src     = heap.heapF32;
      for (let i = 0; i < SID_BUFFER_SIZE; i++) {
        sidRing[(sidRingWrite + i) % SID_RING_SIZE] = src[base + i];
      }
      sidRingWrite = (sidRingWrite + SID_BUFFER_SIZE) % SID_RING_SIZE;
      sidRingCount = Math.min(sidRingCount + SID_BUFFER_SIZE, SID_RING_SIZE);
    } catch (_) {}
  }

  /** Dequeue up to n samples from the JS ring into sidFrameBuf. Returns true if enough data. */
  function dequeueSidFrame() {
    // If the ring doesn't have a full frame yet, pad with silence rather than
    // stalling — this can happen on the very first frames before the SID has
    // had time to fill a full 4096-sample chunk.
    if (sidRingCount < samplesPerFrame) {
      sidFrameBuf.fill(0);
      return false;
    }
    for (let i = 0; i < samplesPerFrame; i++) {
      sidFrameBuf[i] = sidRing[(sidRingRead + i) % SID_RING_SIZE];
    }
    sidRingRead  = (sidRingRead + samplesPerFrame) % SID_RING_SIZE;
    sidRingCount -= samplesPerFrame;
    return true;
  }


  // Resolve output path once — treat remote URLs verbatim, local file paths
  // should be resolved relative to the current working directory (process.cwd()).
  // If no output provided, fall back to repoRoot/temp as before.
  const isRemoteUrl = (s) => /^[a-zA-Z]+:\/\//.test(s);
  const outPathResolved = output
    ? (isRemoteUrl(output) ? output : path.resolve(process.cwd(), output))
    : path.join(repoRoot, 'temp', `c64-record-${Date.now()}.mp4`);
  const isRtmpOutput = isRemoteUrl(outPathResolved);

  // Setup ffmpeg runner if recording requested
  let ffmpegRunner = null;
  let frameSize = 384 * 272 * 4;

  // Helper: start (or restart) ffmpeg. Returns true on success.
  async function startFfmpeg() {
    ffmpegRunner = new FFmpegRunner();
    const started = await ffmpegRunner.start({
      output: outPathResolved,
      width: 384,
      height: 272,
      fps,
      duration: durationSec,
      raw,
      verbose,
      audio,
      sampleRate: audioSampleRate
    });
    return started;
  }

  if (record) {
    try {
      const started = await startFfmpeg();
      if (!started) {
        const msg = 'ffmpeg-record-failed:start-failed';
        out.push(msg);
        console.error('[headless] ' + msg);
        return {ok: false, output: out};
      } else {
        const msg = `Recording to ${outPathResolved} (${durationSec ? durationSec + 's' : 'endless'} @ ${fps}fps${audio ? ' +audio' : ''})`;
        out.push(msg);
        console.error('[headless] ' + msg);
      }
    } catch (e) {
      out.push(`ffmpeg-record-failed: ${String(e)}`);
      record = false;
    }
  }

  // runStartTime is set AFTER ffmpeg starts so --duration counts from when
  // recording actually begins (after any RTMP probe/stabilisation delay).
  const runStartTime = Date.now();
  const isStreamingMode = record || webrtc;
  const endTime = isStreamingMode
    ? (durationSec ? runStartTime + durationSec * 1000 : Infinity)
    : null;

  let windowStart = Date.now();
  let windowCount = 0;

  while (isStreamingMode ? Date.now() < endTime : frameCount < frames) {
    try {
      if (verbose && frameCount % 50 === 0) console.error(`[headless] loop frameCount=${frameCount}`);

      // Run one full frame of emulation.
      const frameMs = Math.round(1000 / targetFps);
      exports.debugger_update(frameMs);

      // Capture time after emulation work — sleepMs is then always measured
      // from when this frame actually finished, never stale from before a
      // loadCartridge blockage.
      const iterStart = Date.now();

      // ── Audio: pull from WASM SID → JS ring → per-frame slice ───────────
      // Accumulate emulated samples; when we cross a SID_BUFFER_SIZE boundary
      // pull one 4096-sample chunk from the WASM into the JS ring (safe call
      // rate — never resets the SID counter mid-stream).
      // Then dequeue exactly samplesPerFrame into sidFrameBuf for this frame.
      if (audio || (webrtc && webrtcEncoder)) {
        sidSampleAccum += samplesPerFrame;
        while (sidSampleAccum >= SID_BUFFER_SIZE) {
          sidSampleAccum -= SID_BUFFER_SIZE;
          pullSidBuffer();
        }
        dequeueSidFrame(); // fills sidFrameBuf (or silence if ring not primed yet)
      }

      // ── WebRTC: push video + audio into the live track ─────────────────
      // This is independent of ffmpeg recording; both can run simultaneously.
      if (webrtc && webrtcEncoder) {
        try {
          const ptr  = exports.c64_getPixelBuffer();
          const rgba = heap.heapU8.subarray(ptr, ptr + 384 * 272 * 4);
          webrtcEncoder.pushVideoFrame(rgba);
        } catch (e) {
          if (verbose) console.error('[headless] webrtc video push error:', e && e.message);
        }

        // WebRTC audio — send exactly samplesPerFrame samples every frame
        // using the sidFrameBuf already dequeued from the JS ring above.
        if (audio || sidRingCount >= 0) {
          try {
            webrtcEncoder.pushAudioFrame(sidFrameBuf);
          } catch (e) {
            if (verbose) console.error('[headless] webrtc audio push error:', e && e.message);
          }
        }
      }

      // Capture video frame and audio chunk, then write both atomically.
      // await writeFrame() provides genuine backpressure: the loop waits for
      // ffmpeg to consume each frame before advancing, so it can never run
      // faster than ffmpeg can encode — no burst/spin behaviour possible.
      if (record && ffmpegRunner) {
        // Check if ffmpeg died before attempting to write
        if (!ffmpegRunner.isAlive()) {
          const code = ffmpegRunner._exitCode;
          const errMsg = `ffmpeg process exited unexpectedly (code ${code}) after ${frameCount} frames`;
          out.push(errMsg);
          console.error(`[headless] ${errMsg}`);

          // For URL/RTMP outputs, retry with backoff — transient connection failures are normal
          if (isRtmpOutput) {
            const retryDelaySec = 10;
            console.error(`[headless] RTMP output — retrying ffmpeg in ${retryDelaySec}s...`);
            await new Promise((r) => setTimeout(r, retryDelaySec * 1000));
            try {
              const restarted = await startFfmpeg();
              if (restarted) {
                console.error('[headless] ffmpeg restarted successfully');
              } else {
                console.error('[headless] ffmpeg restart failed — giving up');
                ffmpegDied = true;
                record = false;
                break;
              }
            } catch (restartErr) {
              console.error('[headless] ffmpeg restart threw:', restartErr && restartErr.message);
              ffmpegDied = true;
              record = false;
              break;
            }
          } else {
            ffmpegDied = true;
            record = false;
            break;
          }
        }
        try {
          const ptr = exports.c64_getPixelBuffer();
          const videoFrame = heap.heapU8.subarray(ptr, ptr + frameSize);
          // Audio: use the per-frame slice dequeued from the JS ring above —
          // samplesPerFrame samples per frame, every frame (silence until primed).
          // This ensures ffmpeg receives audio at a constant rate perfectly
          // aligned with video, eliminating A/V sync drift.
          const audioChunk = audio ? sidFrameBuf : null;
          await ffmpegRunner.writeFrame(videoFrame, audioChunk);
        } catch (e) {
          const errMsg = `ffmpeg write error after ${frameCount} frames: ${e && e.message ? e.message : String(e)}`;
          out.push(errMsg);
          console.error(`[headless] ${errMsg}`);
          // For URL outputs, don't give up immediately — ffmpeg may have just died,
          // the isAlive() check at the top of next iteration will handle the retry.
          if (!isRtmpOutput) {
            ffmpegDied = true;
            record = false;
            break;
          }
        }
      }
      // Throttle to target FPS: sleep for the remainder of the frame interval.
      const sleepMs = Math.max(0, frameMs - (Date.now() - iterStart));
      await new Promise((r) => setTimeout(r, sleepMs));
    } catch (_) {
    }
    frameCount++;
    // diagnostics
    windowCount++;
    if (windowCount >= 50) {
      const now = Date.now();
      const secs = (now - windowStart) / 1000;
      windowStart = now;
      windowCount = 0;
    }
    if (verify && frameCount % 60 === 0) {
      const cycleCount = exports.c64_getCycleCount ? exports.c64_getCycleCount() : null;
      out.push(JSON.stringify({pid: process.pid, frame: frameCount, cycles: cycleCount}));
      try {
        const pc = exports.c64_getPC ? exports.c64_getPC() : null;
        console.error(`[headless] verify: frame=${frameCount} pc=${pc} cycles=${cycleCount}`);
      } catch (_) {
      }
    }
  }

  const elapsed = (Date.now() - runStartTime) / 1000;
  out.push(`Run complete. frames=${frameCount} elapsed=${elapsed.toFixed(2)}s`);

  // ── Shut down input server ────────────────────────────────────────────────
  if (inputServer) {
    try {
      await inputServer.close();
      if (verbose) console.error('[headless] input server closed');
    } catch (e) {
      console.error('[headless] input server close error:', e && e.message ? e.message : e);
    }
  }

  // ── Shut down WebRTC server ───────────────────────────────────────────────
  if (webrtcServer) {
    try {
      await webrtcServer.close();
      if (verbose) console.error('[headless] webrtc server closed');
    } catch (e) {
      console.error('[headless] webrtc server close error:', e && e.message ? e.message : e);
    }
  }

  if (record && ffmpegRunner) {
    // Clear audio interval if it was used (currently null/no-op)
    if (audioInterval) {
      clearInterval(audioInterval);
      audioInterval = null;
    }
    try {
      const saved = await ffmpegRunner.stop();
      // Verify the file exists and is non-empty
      try {
        // If the saved path is a URL (rtmp://, rtmps://, srt://, etc.)
        // there is no filesystem entry to stat — treat it as a published
        // network output and report success.
        if (typeof saved === 'string' && /^[a-zA-Z]+:\/\//.test(saved)) {
          out.push(`Published: ${saved}`);
        } else {
          const stat = await fs.stat(saved);
          if (stat.size > 0) out.push(`Saved: ${saved}`);
          else out.push(`Saved-empty: ${saved}`);
        }
      } catch (e) {
        out.push(`Saved-missing: ${saved} (${String(e)})`);
      }
    } catch (e) {
      out.push(`ffmpeg-stop-failed: ${String(e)}`);
    }
  }
  return {ok: !ffmpegDied, output: out};
}

export default runHeadless;

// If this file is executed directly, run the CLI.
try {
  const thisFile = fileURLToPath(import.meta.url);
  // Resolve argv[1] to an absolute path so running with a relative path
  // (e.g. `node src/headless/headless-cli.mjs`) still matches.
  const argv1Resolved = process.argv && process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (argv1Resolved && argv1Resolved === thisFile) {
    (async () => {
      const res = await runHeadless();
      if (res) {
        if (Array.isArray(res.output)) {
          for (const line of res.output) console.log(line);
        } else if (res.output) {
          console.log(res.output);
        }
        if (!res.ok) process.exit(1);
      }
      process.exit(0);
    })().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
} catch (e) {
  // ignore errors in CLI wrapper detection
}

