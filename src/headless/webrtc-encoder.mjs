/**
 * webrtc-encoder.mjs
 *
 * Bridges the WASM pixel buffer (RGBA) → WebRTC video track
 * and WASM F32 PCM audio → WebRTC audio track.
 *
 * Uses the @roamhq/wrtc nonstandard API:
 *   RTCVideoSource  — push raw I420 frames into the WebRTC pipeline
 *   RTCAudioSource  — push raw Int16 PCM into the WebRTC pipeline
 *   rgbaToI420      — fast RGBA → I420 colour-space conversion helper
 *
 * Both tracks are shared across all peer connections: every connected
 * browser sees the same video/audio feed from the single emulator instance.
 */

import wrtc from '@roamhq/wrtc';

const { RTCVideoSource, RTCAudioSource, rgbaToI420 } = wrtc.nonstandard;

export class WebRTCEncoder {
  /** @type {import('@roamhq/wrtc').nonstandard.RTCVideoSource|null} */
  videoSource = null;
  /** @type {import('@roamhq/wrtc').nonstandard.RTCAudioSource|null} */
  audioSource = null;
  /** @type {MediaStreamTrack|null} */
  videoTrack = null;
  /** @type {MediaStreamTrack|null} */
  audioTrack = null;

  _width = 384;
  _height = 272;
  _sampleRate = 44100;

  // Wall-clock origin for video timestamps (µs since Unix epoch at init()).
  // Video timestamps are driven by (Date.now() - _videoOriginMs) * 1000 µs so
  // that after any gap (e.g. the ~1300ms c64_loadCartridge() blockage) the
  // next frame's timestamp automatically jumps forward by the real elapsed
  // time.  This keeps the video RTP clock aligned with the audio RTP clock,
  // which advances at the real-time rate even when no audio is pushed.
  //
  // Previous approach (frame-counter × frame-duration) was intended to hide
  // the gap from the receiver, but it caused the video RTP timestamps to fall
  // ~1300ms *behind* the audio clock after every cart load.  The browser's
  // AV sync logic then delayed video rendering until the audio clock "caught
  // up", creating the observed ~1–30s of perceived input lag.
  _videoOriginMs = 0;   // set in init() to Date.now()
  _videoFrameDurationUs = 0; // microseconds per frame, set in setFps() (kept for compatibility)

  // RTCAudioSource.onData() requires exactly (sampleRate / 100) samples per call —
  // that is one 10 ms WebRTC audio processing frame.  At 44100 Hz that is 441 samples.
  // The SID buffer is 4096 samples, so we queue incoming audio and drain it in
  // 441-sample chunks.
  _audioChunkSize = 441;      // recalculated in init()
  // Pre-allocated audio ring buffer — large enough to hold several SID pulls
  // without allocation.  Using a ring avoids per-frame Float32Array allocs
  // (which caused GC pauses and audio stuttering at 50fps).
  _audioRing = null;          // Float32Array, allocated in init()
  _audioRingSize = 0;
  _audioRingWrite = 0;
  _audioRingRead = 0;
  _audioRingCount = 0;
  _audioInt16 = null;         // Int16Array(chunkSize), allocated in init()
  // Pre-allocated staging buffers — reused every frame to avoid GC pressure.
  // rgbaToI420() validates data.byteLength === width*height*4, so we cannot
  // pass a subarray of the WASM heap (whose byteLength = full heap size).
  // Copying into _rgbaBuf each frame is one memcpy (~417 KB) — negligible.
  _rgbaBuf = null;   // Uint8ClampedArray(width*height*4)
  _i420Buf = null;   // Uint8ClampedArray(width*height * 3/2)

  /**
   * @param {{ width?: number, height?: number, sampleRate?: number }} opts
   */
  init({ width = 384, height = 272, sampleRate = 44100 } = {}) {
    this._width = width;
    this._height = height;
    this._sampleRate = sampleRate;
    this._audioChunkSize = Math.floor(sampleRate / 100); // 441 @ 44100, 480 @ 48000
    // Audio ring: large enough for 8× the SID pull size (8×4096 = 32768 samples)
    // so even bursts after a cart load never overflow.
    this._audioRingSize  = 4096 * 8;
    this._audioRing      = new Float32Array(this._audioRingSize);
    this._audioRingWrite = 0;
    this._audioRingRead  = 0;
    this._audioRingCount = 0;
    this._audioInt16  = new Int16Array(this._audioChunkSize);
    this._videoOriginMs = Date.now();

    // Staging buffers with exact byte sizes that rgbaToI420 expects
    this._rgbaBuf = new Uint8ClampedArray(width * height * 4);
    const i420Size = width * height + (width >> 1) * (height >> 1) * 2;
    this._i420Buf = new Uint8ClampedArray(i420Size);

    // isScreencast: true — tells libwebrtc this is screen/game content, not a camera.
    // Effect: disables temporal noise filtering, prefers crisp frames over smooth
    // motion estimation, and reduces encoder buffering latency.
    this.videoSource = new RTCVideoSource({ isScreencast: true });
    this.audioSource = new RTCAudioSource();

    this.videoTrack = this.videoSource.createTrack();
    this.audioTrack = this.audioSource.createTrack();
  }

  /**
   * No-op retained for call-site compatibility.
   */
  resetVideoTimestamp() {
    // intentional no-op
  }

  /**
   * Push enough silence audio frames to cover a wall-clock gap.
   *
   * Root cause of post-load input lag
   * ──────────────────────────────────
   * RTCAudioSource is a *push* source: its RTP clock advances only when
   * onData() is called.  During the ~1300ms blockage of c64_loadCartridge()
   * (and the shorter ~110ms blockage of c64_reset()/detach), the frame loop
   * is frozen so no audio is pushed.  The video track's RTP clock, however,
   * is driven internally by @roamhq/wrtc using the wall clock and keeps
   * ticking throughout the gap.
   *
   * Result: video RTP is 1300ms ahead of audio RTP when frames resume.
   * The browser's AV sync logic holds video playback until the audio clock
   * catches up — which is experienced as ~1–30s of input lag (the perceived
   * lag is the browser waiting for audio to "fill" the 1300ms debt at the
   * real-time audio rate of 441 samples / 10ms = 130 push calls to drain).
   *
   * Fix: immediately after any blocking WASM call, push silence audio frames
   * totalling the measured wall-clock gap.  This advances the audio RTP
   * clock by the same amount the video RTP clock advanced during the gap,
   * so both clocks re-align and the browser can render video without delay.
   *
   * @param {number} gapMs  Wall-clock duration of the gap in milliseconds.
   */
  pushSilenceForGap(gapMs) {
    if (!this.audioSource || gapMs <= 0) return;
    const chunkSize  = this._audioChunkSize;   // 441 @ 44100 Hz
    const sampleRate = this._sampleRate;
    // Number of silence samples needed to cover the gap
    const totalSamples = Math.round((gapMs / 1000) * sampleRate);
    // Reuse _audioInt16 (already allocated, zero-filled on first use).
    // It may still contain data from the last pushAudioFrame call, so zero it.
    this._audioInt16.fill(0);
    const int16 = this._audioInt16;
    let pushed = 0;
    while (pushed + chunkSize <= totalSamples) {
      this.audioSource.onData({
        samples:        int16,
        sampleRate:     sampleRate,
        bitsPerSample:  16,
        channelCount:   1,
        numberOfFrames: chunkSize,
      });
      pushed += chunkSize;
    }
  }

  /**
   * Set the frame rate used to compute video timestamps.
   * Must be called after init() if the fps differs from the default 50.
   * @param {number} fps
   */
  setFps(fps) {
    this._videoFrameDurationUs = Math.round(1_000_000 / fps);
  }

  /**
   * Push one RGBA video frame into the WebRTC pipeline.
   *
   * @param {Uint8Array} rgbaData - raw RGBA pixels, width*height*4 bytes
   *   (zero-copy subarray from WASM heap is fine — rgbaToI420 reads it synchronously)
   */
  pushVideoFrame(rgbaData) {
    const width = this._width;
    const height = this._height;

    // Copy pixel data into the pre-sized staging buffer.
    // This is necessary because rgbaToI420 checks data.byteLength strictly.
    this._rgbaBuf.set(rgbaData.subarray(0, width * height * 4));

    rgbaToI420(
      { width, height, data: this._rgbaBuf },
      { width, height, data: this._i420Buf },
    );

    // Drive timestamp from wall clock (microseconds elapsed since init()).
    // After any gap (e.g. the ~1300ms c64_loadCartridge blockage) the timestamp
    // automatically jumps forward by the real elapsed time, keeping the video
    // RTP clock aligned with the audio RTP clock which advances at real-time
    // rate regardless of whether audio frames are pushed.
    const timestamp = (Date.now() - this._videoOriginMs) * 1000;

    this.videoSource.onFrame({ width, height, data: this._i420Buf, timestamp });
  }

  /**
   * Push one block of Float32 PCM audio into the WebRTC pipeline.
   *
   * RTCAudioSource.onData() requires exactly (sampleRate / 100) Int16 samples
   * per call (one 10 ms WebRTC audio frame — 441 @ 44100 Hz, 480 @ 48000 Hz).
   * Incoming SID buffers are 882 samples/frame at 50fps, so we queue into a
   * pre-allocated ring and drain in exact 441-sample chunks.
   * Zero heap allocations per call — no GC pressure, no audio stuttering.
   *
   * @param {Float32Array} f32samples - SID output, sampleRate Hz mono
   */
  pushAudioFrame(f32samples) {
    const chunkSize  = this._audioChunkSize;
    const ringSize   = this._audioRingSize;
    const ring       = this._audioRing;

    // Write incoming samples into the ring (wrap-around, drop on overflow)
    for (let i = 0; i < f32samples.length; i++) {
      if (this._audioRingCount < ringSize) {
        ring[this._audioRingWrite] = f32samples[i];
        this._audioRingWrite = (this._audioRingWrite + 1) % ringSize;
        this._audioRingCount++;
      }
      // overflow: silently drop — should never happen with ring sized 8×SID_BUF
    }

    // Drain completed 10 ms chunks from the ring
    const int16 = this._audioInt16;
    while (this._audioRingCount >= chunkSize) {
      for (let i = 0; i < chunkSize; i++) {
        const s = ring[this._audioRingRead];
        this._audioRingRead = (this._audioRingRead + 1) % ringSize;
        const clamped = s < -1 ? -1 : s > 1 ? 1 : s;
        int16[i] = clamped * 32767;
      }
      this._audioRingCount -= chunkSize;
      this.audioSource.onData({
        samples: int16,
        sampleRate: this._sampleRate,
        bitsPerSample: 16,
        channelCount: 1,
        numberOfFrames: chunkSize,
      });
    }
  }

  get width() { return this._width; }
  get height() { return this._height; }
}

