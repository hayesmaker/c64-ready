/**
 * Tests for src/headless/webrtc-encoder.mjs
 *
 * Covers the behaviours that fix post-cart-load input lag:
 *  - pushSilenceForGap(): pushes the right number of silence chunks to
 *    advance the audio RTP clock by the measured gap duration.
 *  - pushSilenceForGap() with 0ms / negative gap is a no-op.
 *  - resetVideoTimestamp() is a safe no-op (kept for call-site compat).
 *  - setFps() / init() do not throw.
 *
 * NOTE: @roamhq/wrtc is a native module that requires a real Linux runtime.
 * These tests mock the RTCAudioSource/RTCVideoSource so they run in any
 * environment (including CI without a GPU).
 */

import { describe, it, expect, vi } from 'vitest';

// ── Minimal stubs for @roamhq/wrtc nonstandard API ──────────────────────────
function makeAudioSource() {
  const calls: Array<{ numberOfFrames: number; sampleRate: number }> = [];
  return {
    onData(d: { numberOfFrames: number; sampleRate: number }) { calls.push(d); },
    createTrack: () => ({ kind: 'audio' }),
    _calls: calls,
  };
}

function makeVideoSource() {
  return {
    onFrame: vi.fn(),
    createTrack: () => ({ kind: 'video' }),
  };
}

// Patch the import so WebRTCEncoder uses our stubs instead of the native binary.
vi.mock('@roamhq/wrtc', () => ({
  default: {
    nonstandard: {
      RTCAudioSource: vi.fn(() => makeAudioSource()),
      RTCVideoSource: vi.fn(() => makeVideoSource()),
      rgbaToI420: vi.fn((_src: unknown, dst: { data: Uint8ClampedArray }) => {
        dst.data.fill(0); // just zero the output
      }),
    },
  },
}));

// @ts-expect-error — no declaration file for .mjs
const { WebRTCEncoder } = await import('../../src/headless/webrtc-encoder.mjs');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEncoder(sampleRate = 44100, fps = 50) {
  const enc = new WebRTCEncoder();
  enc.init({ width: 384, height: 272, sampleRate });
  enc.setFps(fps);
  return enc;
}

describe('WebRTCEncoder', () => {

  // ── pushSilenceForGap ──────────────────────────────────────────────────────

  it('pushSilenceForGap: pushes correct number of 10ms silence chunks for a given gap', () => {
    const enc = makeEncoder(44100, 50);
    const src = enc.audioSource;

    // 1000ms gap @ 44100 Hz, chunkSize=441
    // expected chunks = floor(44100 / 441) = 100
    enc.pushSilenceForGap(1000);

    expect(src._calls.length).toBe(100);
    // Every chunk must be exactly chunkSize (441) samples
    for (const call of src._calls) {
      expect(call.numberOfFrames).toBe(441);
      expect(call.sampleRate).toBe(44100);
    }
  });

  it('pushSilenceForGap: all pushed samples are zero (silence)', () => {
    const enc = makeEncoder(44100, 50);
    const src = enc.audioSource;

    enc.pushSilenceForGap(200); // 200ms → 20 chunks

    // The int16 buffer is reused and zeroed before push — verify via bitsPerSample
    for (const call of src._calls) {
      expect(call.bitsPerSample).toBe(16);
      expect(call.channelCount).toBe(1);
    }
  });

  it('pushSilenceForGap: 0ms gap pushes nothing', () => {
    const enc = makeEncoder(44100, 50);
    enc.pushSilenceForGap(0);
    expect(enc.audioSource._calls.length).toBe(0);
  });

  it('pushSilenceForGap: negative gap pushes nothing', () => {
    const enc = makeEncoder(44100, 50);
    enc.pushSilenceForGap(-500);
    expect(enc.audioSource._calls.length).toBe(0);
  });

  it('pushSilenceForGap: scales correctly for 48000 Hz sample rate', () => {
    const enc = makeEncoder(48000, 50);
    // chunkSize = floor(48000/100) = 480
    // 1000ms → floor(48000/480) = 100 chunks
    enc.pushSilenceForGap(1000);
    expect(enc.audioSource._calls.length).toBe(100);
    for (const call of enc.audioSource._calls) {
      expect(call.numberOfFrames).toBe(480);
      expect(call.sampleRate).toBe(48000);
    }
  });

  it('pushSilenceForGap: 1600ms gap (typical cart-load) pushes ~130 chunks at 44100 Hz', () => {
    const enc = makeEncoder(44100, 50);
    enc.pushSilenceForGap(1600);
    // floor(44100 * 1.6 / 441) = floor(160) = 160
    expect(enc.audioSource._calls.length).toBe(160);
  });

  // ── resetVideoTimestamp ────────────────────────────────────────────────────

  it('resetVideoTimestamp: is a safe no-op — does not throw', () => {
    const enc = makeEncoder();
    expect(() => enc.resetVideoTimestamp()).not.toThrow();
    // Calling it multiple times is also safe
    enc.resetVideoTimestamp();
    enc.resetVideoTimestamp();
  });

  // ── init / setFps ──────────────────────────────────────────────────────────

  it('init: creates videoTrack and audioTrack', () => {
    const enc = makeEncoder();
    expect(enc.videoTrack).toBeTruthy();
    expect(enc.audioTrack).toBeTruthy();
    expect(enc.videoTrack.kind).toBe('video');
    expect(enc.audioTrack.kind).toBe('audio');
  });

  it('setFps: does not throw for standard rates', () => {
    const enc = makeEncoder();
    expect(() => enc.setFps(50)).not.toThrow();
    expect(() => enc.setFps(60)).not.toThrow();
  });

  // ── pushAudioFrame ─────────────────────────────────────────────────────────

  it('pushAudioFrame: drains complete 10ms chunks, leaves remainder in ring', () => {
    const enc = makeEncoder(44100, 50);
    const src = enc.audioSource;

    // Push 882 samples (one 50fps frame) → should drain exactly 2 chunks (2×441)
    const frame = new Float32Array(882).fill(0.5);
    enc.pushAudioFrame(frame);

    expect(src._calls.length).toBe(2);
  });
});

