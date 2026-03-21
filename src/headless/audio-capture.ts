/**
 * Audio capture for headless operation
 */

import type { AudioBuffer } from '../types';

export class AudioCapture {
  private latestAudio: Float32Array | null = null;
  private audioQueue: Float32Array[] = [];

  capture(audio: AudioBuffer): void {
	// Copy samples so the caller owns them
	this.latestAudio = audio.samples.slice();
	this.audioQueue.push(this.latestAudio);
  }

  getLatest(): Float32Array | null {
	return this.latestAudio;
  }

  getQueued(): Float32Array[] {
	const q = this.audioQueue;
	this.audioQueue = [];
	return q;
  }

  clearQueue(): void {
	this.audioQueue = [];
  }
}


