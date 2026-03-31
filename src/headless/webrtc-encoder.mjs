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

  // Monotonic video frame counter — used to compute an explicit timestamp
  // for each frame passed to videoSource.onFrame().  Driving the timestamp
  // from the frame count rather than Date.now() means the ~1300ms wall-clock
  // blockage during loadCartridge() is invisible to the WebRTC receiver:
  // frames resume at the next sequential timestamp with no perceived gap.
  _videoFrameCount = 0;
  _videoFrameDurationUs = 0; // microseconds per frame, set in init()

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
    this._audioInt16     = new Int16Array(this._audioChunkSize);
    this._videoFrameCount = 0;

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
   * Previously reset the video frame counter to 0 on each cart load.
   * This caused the browser WebRTC receiver to see a backwards timestamp
   * jump (e.g. 50 000 000 µs → 0 µs), forcing a 20-25 s re-buffer window
   * that manifested as apparent input lag after every game switch.
   *
   * The counter must be monotonically increasing across cart loads — the
   * ~1300 ms loadCartridge blockage is already invisible to the receiver
   * because no frames are sent during it; timestamps simply resume from
   * where they left off with no discontinuity.
   *
   * Kept as a no-op for call-site compatibility.
   */
  resetVideoTimestamp() {
    // intentional no-op — do NOT reset _videoFrameCount
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

    // Drive timestamp from frame count × frame duration (microseconds).
    // This makes the video timeline independent of wall-clock gaps caused by
    // blocking WASM calls (loadCartridge, etc.).
    const timestamp = this._videoFrameCount * this._videoFrameDurationUs;
    this._videoFrameCount++;

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

