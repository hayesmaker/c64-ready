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

  // RTCAudioSource.onData() requires exactly (sampleRate / 100) samples per call —
  // that is one 10 ms WebRTC audio processing frame.  At 44100 Hz that is 441 samples.
  // The SID buffer is 4096 samples, so we queue incoming audio and drain it in
  // 441-sample chunks.
  _audioChunkSize = 441;      // recalculated in init()
  _audioQueue = new Float32Array(0);  // pending samples not yet dispatched
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
    this._audioQueue = new Float32Array(0);

    // Staging buffers with exact byte sizes that rgbaToI420 expects
    this._rgbaBuf = new Uint8ClampedArray(width * height * 4);
    const i420Size = width * height + (width >> 1) * (height >> 1) * 2;
    this._i420Buf = new Uint8ClampedArray(i420Size);

    this.videoSource = new RTCVideoSource();
    this.audioSource = new RTCAudioSource();

    this.videoTrack = this.videoSource.createTrack();
    this.audioTrack = this.audioSource.createTrack();
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

    this.videoSource.onFrame({ width, height, data: this._i420Buf });
  }

  /**
   * Push one block of Float32 PCM audio into the WebRTC pipeline.
   *
   * RTCAudioSource.onData() requires exactly (sampleRate / 100) Int16 samples
   * per call (one 10 ms WebRTC audio frame — 441 @ 44100 Hz, 480 @ 48000 Hz).
   * Incoming SID buffers are 4096 samples, so we queue and drain in exact chunks.
   *
   * @param {Float32Array} f32samples - SID output, sampleRate Hz mono
   */
  pushAudioFrame(f32samples) {
    const chunkSize = this._audioChunkSize;

    // Append incoming samples to the queue
    const merged = new Float32Array(this._audioQueue.length + f32samples.length);
    merged.set(this._audioQueue, 0);
    merged.set(f32samples, this._audioQueue.length);
    this._audioQueue = merged;

    // Drain completed 10 ms chunks
    let offset = 0;
    while (offset + chunkSize <= this._audioQueue.length) {
      const chunk = this._audioQueue.subarray(offset, offset + chunkSize);
      const int16 = new Int16Array(chunkSize);
      for (let i = 0; i < chunkSize; i++) {
        const clamped = chunk[i] < -1 ? -1 : chunk[i] > 1 ? 1 : chunk[i];
        int16[i] = clamped * 32767;
      }
      this.audioSource.onData({
        samples: int16,
        sampleRate: this._sampleRate,
        bitsPerSample: 16,
        channelCount: 1,
        numberOfFrames: chunkSize,
      });
      offset += chunkSize;
    }

    // Keep any leftover samples for the next call
    this._audioQueue = this._audioQueue.slice(offset);
  }

  get width() { return this._width; }
  get height() { return this._height; }
}

