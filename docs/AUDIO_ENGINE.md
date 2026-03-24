// Copied from repository root AUDIO_ENGINE.md
# Audio Engine

Technical documentation for the C64-Ready audio subsystem — how the WASM SID
chip produces audio, how the browser consumes it, and why the architecture is
the way it is.

---

## Overview

The Commodore 64's SID (Sound Interface Device) chip is emulated inside the
C64 WASM binary. The SID generates audio samples as a side-effect of running
CPU cycles. A separate Web Audio pipeline on the browser side reads those
samples and plays them through the speakers.

```
┌───────────────────────┐      ┌──────────────────────┐      ┌─────────────┐
│  WASM Emulator Core   │      │   Main Thread         │      │ Audio Thread │
│                       │      │                       │      │  (Worklet)   │
│  debugger_update(dt)  │      │                       │      │              │
│    └─ runs CPU cycles │      │                       │      │              │
│    └─ SID fills a     │ ───> │  getSidBuffer()       │ ───> │  Ring buffer │
│       4096-sample     │      │  reads WASM heap      │      │  ───> DAC    │
│       circular buffer │      │  posts to worklet     │      │              │
│                       │      │                       │ <─── │  'need-      │
│                       │      │                       │      │   samples'   │
└───────────────────────┘      └──────────────────────┘      └─────────────┘
```

---

## WASM SID Exports

These are the relevant exported functions from the compiled C64 WASM binary
(`c64.wasm`). Defined in `src/types/emulator.ts` under `WASMExports`.

### `sid_getAudioBuffer(): number`

Returns a **pointer** (byte offset) into WASM linear memory where the SID's
audio buffer begins. The buffer contains `Float32` samples.

- The pointer is **stable** for the lifetime of the WASM instance — cache it.
- The buffer size is **4096 Float32 samples** (16 384 bytes).
- The buffer is **filled on demand** when this function is called — it does
  not update passively as `debugger_update` runs. Each call synthesises audio
  for the CPU cycles accumulated since the previous call and resets the
  internal sample counter for the next fill cycle.
- Call it at the **4096-sample rate** (~every 4.65 video frames at 50 fps).
  Calling it too frequently resets the counter mid-fill, causing runaway
  emulation speed and a constant-tone audio artefact.

To read the samples from JavaScript:

```ts
const ptr = exports.sid_getAudioBuffer();
const samples = heapF32.slice(ptr >> 2, (ptr >> 2) + 4096);
```

### `sid_setSampleRate(rate: number): number`

Configures the SID to generate samples at the given rate (Hz). Must be called
**before** audio playback begins, typically with the `AudioContext.sampleRate`
(usually 44 100 or 48 000 Hz on most systems).

```ts
sid_setSampleRate(audioContext.sampleRate); // e.g. 48000
```

### `sid_dumpBuffer(): number`

Returns the number of samples currently in the buffer and **resets an internal
write pointer**. 

> **⚠️ Do NOT call this function during normal audio playback.**
>
> The original `c64.js` runtime never calls `sid_dumpBuffer()`. Calling it
> changes the SID's internal timing state and causes the emulator to speed up
> dramatically (the WASM `debugger_update` runs extra CPU cycles to refill the
> drained buffer, creating a runaway feedback loop).
>
> It is exported and may be useful for diagnostics or headless audio capture,
> but must not be called in the browser frame loop.

### `sid_setModel(model: number): void`

Select the SID chip model:
- `0` — MOS 6581 (original, "warm" sound)
- `1` — MOS 8580 (revised, "cleaner" sound)

### `sid_setVoiceEnabled(voice: number): number`

Enable or disable individual SID voices (1–3). Pass `0` to disable.

### `sid_getAudioBufferCh(ch: number): number`

Returns a pointer to a per-channel audio buffer (for waveform visualisation).
Requires `sid_setChannelBuffersEnabled(1)` to be called first.

### `sid_getWaveformByte(index: number): number`

Read a byte from the SID waveform table (debugging / visualisation).

---

## How the Original c64.js Handled Audio

The original runtime used the (now deprecated) `ScriptProcessorNode`:

```js
this.audioBufferLength = 4096;
this.audioCtx = this.audioCtx || new AudioContext();
this.sampleRate = this.audioCtx.sampleRate;
sid_setSampleRate(this.sampleRate);

this.scriptNode = this.audioCtx.createScriptProcessor(4096, 0, 1);
this.scriptNode.onaudioprocess = function (e) {
  var channelData = e.outputBuffer.getChannelData(0);
  var ptr = sid_getAudioBuffer();
  var view = new Float32Array(
    HEAPF32.subarray((ptr >> 2), (ptr >> 2) + 4096)
  );
  channelData.set(view);
};
this.scriptNode.connect(gainNode);
gainNode.connect(this.audioCtx.destination);
```

Key characteristics:

1. **Pull-based** — the browser's audio system calls `onaudioprocess` when it
   needs 4096 samples. The callback reads directly from the SID buffer.
2. **Hardware-clocked** — `onaudioprocess` fires at a rate determined by the
   audio hardware: `sampleRate / bufferSize` Hz (e.g. 48 000 / 4096 ≈ 11.7 Hz).
3. **No `sid_dumpBuffer()` call** — the buffer is read but never "drained".
4. The `ScriptProcessorNode` runs on the **main thread**, which is why it was
   deprecated (it blocks the main thread and causes jank).

---

## C64-Ready AudioWorkletNode Implementation

We replace `ScriptProcessorNode` with `AudioWorkletNode`, which runs on a
**dedicated audio thread** — no main-thread blocking.

### Architecture

| Component | File | Thread |
|---|---|---|
| AudioEngine | `src/player/audio-engine.ts` | Main |
| Worklet Processor | `public/audio-worklet-processor.js` | Audio |
| SID Buffer Reader | `C64Emulator.getSidBuffer()` | Main |

### Pull Model

The worklet processor maintains a **32 768-sample ring buffer**. Its
`process()` method runs ~375 times per second (48 000 Hz / 128 samples per
quantum). When the ring buffer drops below a **low water mark** (8 192
samples, i.e. 2 × chunk size), the processor posts a `'need-samples'` message
to the main thread.

The main thread's `AudioEngine` responds by:
1. Calling the registered `SidBufferReader` function
2. Which calls `C64Emulator.getSidBuffer()`
3. Which reads 4096 Float32 samples from WASM heap via `sid_getAudioBuffer()`
4. Posts the `Float32Array` back to the worklet

The worklet writes the incoming samples into the ring buffer and resets its
`requested` flag, allowing the cycle to repeat.

```
Audio Thread                          Main Thread
─────────────────────────────         ──────────────────────────
process() called by browser
  ├─ output 128 samples from ring buf
  ├─ samplesAvailable < lowWaterMark?
  │   YES → port.postMessage('need-samples')
  │                                     port.onmessage fires
  │                                       ├─ call getSidBuffer()
  │                                       │   └─ read WASM heapF32[ptr..ptr+4096]
  │                                       └─ port.postMessage(Float32Array)
  ├─ port.onmessage fires
  │   └─ write samples into ring buf
  └─ next process() call…
```

### Why Pull, Not Push?

We initially tried pushing samples from `requestAnimationFrame` (60 Hz) and
from `setInterval` (~12 Hz). Both caused audio glitches:

- **rAF push (60 fps)** — Posts 4096 samples × 60 = 245 760 samples/sec, but
  the AudioContext only consumes ~48 000/sec. Massive ring buffer overflow.
- **setInterval push (~85 ms)** — `setInterval` has inherent jitter (4 ms+
  minimum resolution, worse during GC or tab backgrounding). Caused periodic
  underruns and choppiness.

The pull model locks timing to the **audio hardware clock** — the worklet's
`process()` method is called by the browser's audio subsystem at precisely the
right rate. This is the same timing model that `ScriptProcessorNode` used,
just running on a separate thread.

### Autoplay Policy

Modern browsers block `AudioContext` from playing until the user interacts
with the page. The engine handles this gracefully:

1. `AudioEngine.init()` creates the `AudioContext` and attempts to `.resume()`
2. If blocked, `init()` returns `false` and a `c64-audio-suspended` event is
   dispatched
3. The UI shows a 🔇 unmute button (top-left, next to the hamburger menu)
4. On click, `AudioEngine.resume()` calls `audioContext.resume()`
5. The `statechange` event fires, `_suspended` becomes `false`, and the
   worklet starts requesting samples

### Volume and Mute

Volume and mute are handled via a `GainNode` in the Web Audio graph:

```
AudioWorkletNode → GainNode → AudioContext.destination
```

- `setMuted(true)` sets `gainNode.gain.value = 0`
- `setMuted(false)` restores `gainNode.gain.value` to the stored volume
- `setVolume(v)` clamps `v` to `[0, 1]` and updates the gain (if not muted)

The settings menu exposes a mute toggle button and a volume slider (0–100%).

---

## Important Constraints

### Never call `sid_dumpBuffer()` in the frame loop

This was the root cause of the emulation speed bug. `sid_dumpBuffer()` resets
the SID's internal sample counter. When `debugger_update(dTime)` runs on the
next tick, it sees an empty buffer and runs extra CPU cycles to fill it,
causing a runaway speed increase.

### Call `sid_getAudioBuffer()` at the right frequency in the headless loop

`sid_getAudioBuffer()` triggers SID synthesis for a full 4096-sample buffer
and takes ~5ms of WASM time per call. **The buffer does not update passively
as `debugger_update` runs** — it only fills when `sid_getAudioBuffer()` is
called. This means:

- Calling it **too often** (every video frame): each call resets the SID's
  internal sample counter; the next `debugger_update` runs extra cycles to
  refill the empty buffer, causing runaway emulation speed. Reading only
  882 samples each time also produces a **constant tone** because the same
  partially-filled region is repeated.
- Calling it **at the right rate** (once per full 4096-sample fill): emulation
  runs at correct speed and you get 4096 samples of real audio per call.

The 4096-sample buffer matches the original `ScriptProcessorNode` buffer size
in `c64.js` (`audioBufferLength = 4096`). At 50 fps (882 samples/frame), one
fill cycle spans ~4.65 video frames.

**Correct headless pattern:** accumulate samples-per-frame, call
`sid_getAudioBuffer()` once per full 4096-sample fill, and send the complete
4096-sample buffer to ffmpeg:

```js
const SID_BUFFER_SIZE = 4096;
const samplesPerFrame = Math.floor(44100 / fps); // e.g. 882 @ 50fps
let sidSampleAccum = 0;

// Per frame (loop):
exports.debugger_update(stepMs);
sidSampleAccum += samplesPerFrame;
if (sidSampleAccum >= SID_BUFFER_SIZE) {
  sidSampleAccum -= SID_BUFFER_SIZE;
  const sidPtr = exports.sid_getAudioBuffer();       // call once per buffer fill
  const sidBase = sidPtr >> 2;
  const audioChunk = heap.heapF32.slice(sidBase, sidBase + SID_BUFFER_SIZE);
  // send audioChunk to ffmpeg / audio sink
}
```

The worklet pull-model (browser) is not affected because `sid_getAudioBuffer()`
is called infrequently there — pulled by the audio thread at the audio buffer
rate (~11.7 Hz at 48 kHz / 4096 samples), not every video frame.

### Always clamp `dTime` in `tick()`

The original c64.js clamps the delta time passed to `debugger_update`:

```js
if (!dTime || dTime > 100) {
  dTime = 1000 / 60; // ~16.67 ms
}
```

Without this, tab switches or the first frame after loading can pass huge
`dTime` values, causing burst execution of millions of CPU cycles.

### The SID buffer is static until `sid_getAudioBuffer()` is called

`sid_getAudioBuffer()` always returns the same pointer (stable for the WASM
instance lifetime). **The 4096-sample buffer does not update passively as
`debugger_update` runs.** It only fills when `sid_getAudioBuffer()` is
called — at that point the SID synthesises up to 4096 samples based on the
CPU cycles accumulated since the last call.

This means the pointer is safe to cache, but reading the buffer between
`sid_getAudioBuffer()` calls will return stale data from the previous fill.

### `sid_setSampleRate()` must match `AudioContext.sampleRate`

If they don't match, the SID generates the wrong number of samples per CPU
cycle, causing audio to play at the wrong pitch/speed. The `AudioEngine`
passes `this.ctx.sampleRate` (typically 44 100 or 48 000) to
`emulator.setSampleRate()` during init.

---

## File Reference

| File | Purpose |
|---|---|
| `src/player/audio-engine.ts` | Main-thread audio controller (AudioContext, GainNode, worklet management) |
| `public/audio-worklet-processor.js` | Audio-thread processor (ring buffer, pull requests) |
| `src/emulator/c64-emulator.ts` | `getSidBuffer()`, `setSampleRate()`, SID WASM wrappers |
| `src/player/c64-player.ts` | Wires AudioEngine to the emulator via `setSidBufferReader()` |
| `src/player/ui-controller.ts` | Unmute button, mute toggle, volume slider in settings menu |
| `src/types/emulator.ts` | TypeScript types for WASM SID exports |
| `temp/c64.js` | Original runtime (reference — contains legacy `ScriptProcessorNode` impl) |



