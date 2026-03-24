import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import FFmpegRunner from './ffmpeg-runner.mjs';

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
  // Use fixed timestep by default to keep emulation timing stable.
  let useFixedDt = true;
  let raw = false;
  let output = null;
  let durationSec = 0; // 0 means no --duration was passed → stream forever when recording
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
    else if (a === '--use-fixed-dt') useFixedDt = true;
    else if (a === '--use-wall-clock') useFixedDt = false;
    else if (a === '--help' || a === '-h') {
      return { ok: false, output: 'help' };
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
      } catch (_) {}
    }
    return null;
  }

  let wasmPath = wasmArg;
  if (!wasmPath) {
    const found = await findFirstExisting(defaultWasmPaths);
    if (found) wasmPath = found;
  }
  if (!wasmPath) return { ok: false, err: 'no-wasm' };

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
  // runtime state placeholders
  let exports = null;
  let heap = null;
  let wrapperUsed = false;

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
      const mem = new WebAssembly.Memory({ initial: 256 });
      const importObject = { env: { memory: mem }, wasi_snapshot_preview1: {} };
      const res = await instantiateFn(wasmAb, importObject);
      const inst = res && (res.instance ?? res);
      exports = inst.exports ?? inst;
      // ensure exports.memory exists so later code can read/write
      if (exports && !exports.memory) exports.memory = mem;
      if (exports && exports.memory) {
        const buf = exports.memory.buffer;
        heap = { heapU8: new Uint8Array(buf), heapF32: new Float32Array(buf), heapU32: new Uint32Array(buf) };
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
    const c64wasm = new C64WASM();
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
    return { ok: false, output: out };
  }

  // Run state and timing
  let frameCount = 0;
  let ffmpegDied = false; // set to true if ffmpeg exits unexpectedly and we give up
  const targetFps = (typeof fps === 'number' && !Number.isNaN(fps) && fps > 0) ? fps : 60;

  // ── Audio timing ──────────────────────────────────────────────────────────
  const audioSampleRate = 44100;
  const samplesPerFrame = Math.floor(audioSampleRate / targetFps); // 882 @ 50fps
  let audioInterval = null;

  // SID audio buffer is 4096 Float32 samples. debugger_update accumulates
  // samples into it across multiple calls. sid_getAudioBuffer() must be
  // called once per full 4096-sample fill — NOT once per video frame —
  // to read the complete buffer and reset it for the next fill cycle.
  //
  // At 50fps: 882 samples/frame × ~4.65 frames = 4096 samples per SID buffer.
  // We track accumulated samples and call sid_getAudioBuffer() each time
  // the total crosses a 4096-sample boundary, sending the full 4096-sample
  // chunk to ffmpeg at that point.
  const SID_BUFFER_SIZE = 4096;
  let sidSampleAccum = 0; // samples accumulated since last sid_getAudioBuffer call

  // Resolve output path once — URL stays verbatim, file paths resolve to repoRoot
  const outPathResolved = output
    ? (/^[a-zA-Z]+:\/\//.test(output) ? output : path.resolve(repoRoot, output))
    : path.join(repoRoot, 'temp', `c64-record-${Date.now()}.mp4`);
  const isRtmpOutput = /^[a-zA-Z]+:\/\//.test(outPathResolved);

  // Setup ffmpeg runner if recording requested
  let ffmpegRunner = null;
  let frameSize = 384 * 272 * 4;

  // Helper: start (or restart) ffmpeg. Returns true on success.
  async function startFfmpeg() {
    ffmpegRunner = new FFmpegRunner();
    const started = await ffmpegRunner.start({ output: outPathResolved, width: 384, height: 272, fps, duration: durationSec, raw, verbose, audio, sampleRate: audioSampleRate });
    return started;
  }

  if (record) {
    try {
      const started = await startFfmpeg();
      if (!started) {
        const msg = 'ffmpeg-record-failed:start-failed';
        out.push(msg);
        console.error('[headless] ' + msg);
        return { ok: false, output: out };
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
  // When recording without an explicit --duration, run forever (endTime = Infinity).
  const endTime = record
    ? (durationSec ? runStartTime + durationSec * 1000 : Infinity)
    : null;
  let lastTick = Date.now();
  let windowStart = Date.now();
  let windowCount = 0;

  while (record ? Date.now() < endTime : frameCount < frames) {
    // iteration start timestamp (declare in outer scope so it's available
    // to the throttle logic even if the try block throws)
    let iterStart = Date.now();
    try {
      if (verbose && frameCount % 50 === 0) console.error(`[headless] loop frameCount=${frameCount}`);
      // Record iteration start time and compute deltaMs. Always update
      // lastTick so the throttle calculation below works correctly for
      // both fixed-dt and wall-clock modes.
      iterStart = Date.now();
      let deltaMs;
      if (useFixedDt) {
        deltaMs = Math.round(1000 / targetFps);
      } else {
        // wall-clock delta in milliseconds since last tick
        deltaMs = iterStart - lastTick;
        if (deltaMs <= 0) deltaMs = Math.round(1000 / targetFps);
        // clamp to a single frame interval to avoid huge jumps
        if (deltaMs > 1000) deltaMs = Math.round(1000 / targetFps);
      }
      lastTick = iterStart;
      // Drive the emulator for one frame interval. One call to debugger_update
      // with the target frame duration (20ms at 50fps) advances exactly one
      // PAL frame worth of C64 cycles. Do NOT call it multiple times per loop
      // iteration — that runs the emulator faster than real-time.
      const stepMs = Math.round(1000 / targetFps); // 20ms at 50fps
      try {
        // Advance emulator one frame. Previously we logged dt/ret here for
        // debugging; remove the per-frame diagnostic to avoid noisy output.
        exports.debugger_update(stepMs);
      } catch (e) {
        if (verbose) console.error('[headless] debugger_update threw', e);
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
          let audioChunk = null;
          if (audio && exports.sid_getAudioBuffer) {
            // Accumulate samples. sid_getAudioBuffer() fills 4096 samples per
            // cycle — call it exactly when the accumulator crosses that boundary,
            // then send the full 4096-sample buffer. This matches the original
            // ScriptProcessorNode pattern in c64.js (audioBufferLength = 4096).
            sidSampleAccum += samplesPerFrame;
            if (sidSampleAccum >= SID_BUFFER_SIZE) {
              sidSampleAccum -= SID_BUFFER_SIZE;
              try {
                const sidPtr = exports.sid_getAudioBuffer();
                const sidBase = sidPtr >> 2;
                // Copy the full 4096-sample buffer so ffmpeg gets a consistent chunk
                audioChunk = heap.heapF32.slice(sidBase, sidBase + SID_BUFFER_SIZE);
              } catch (_) {}
            }
          }
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
    } catch (_) {}
    frameCount++;
    // diagnostics
    windowCount++;
    if (windowCount >= 50) {
      const now = Date.now();
      const secs = (now - windowStart) / 1000;
      const obsFps = windowCount / (secs || 1);
      //console.error(`[headless] observed fps=${obsFps.toFixed(2)} over ${secs.toFixed(2)}s (frames ${frameCount - windowCount}..${frameCount})`);
      windowStart = now;
      windowCount = 0;
    }
    if (verify && frameCount % 60 === 0) {
      const cycleCount = exports.c64_getCycleCount ? exports.c64_getCycleCount() : null;
      out.push(JSON.stringify({ pid: process.pid, frame: frameCount, cycles: cycleCount }));
      // Also emit a stderr heartbeat so interactive runs show progress.
      try {
        const pc = exports.c64_getPC ? exports.c64_getPC() : null;
        console.error(`[headless] verify: frame=${frameCount} pc=${pc} cycles=${cycleCount}`);
      } catch (_) {}
    } else if (frameCount % 120 === 0) {
      //out.push(`HEADLESS: frame=${frameCount}`);
    }
    // Throttle to target FPS: sleep for the remainder of the frame interval
    const frameMs = Math.round(1000 / targetFps);
    const iterElapsed = Date.now() - iterStart;
    const sleepMs = Math.max(0, frameMs - iterElapsed);
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  const elapsed = (Date.now() - runStartTime) / 1000;
  out.push(`Run complete. frames=${frameCount} elapsed=${elapsed.toFixed(2)}s`);
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
  return { ok: !ffmpegDied, output: out };
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
    })().catch((e) => { console.error(e); process.exit(1); });
  }
} catch (e) {
  // ignore errors in CLI wrapper detection
}

