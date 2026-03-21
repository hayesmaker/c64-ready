/**
 * Frame capture for headless operation
 */

import type { FrameBuffer } from '../types';

export class FrameCapture {
  private latestFrame: Uint8Array | null = null;
  private frameQueue: Uint8Array[] = [];

  capture(frame: FrameBuffer): void {
	// Store latest frame (copy to ensure consumer owns the buffer)
	this.latestFrame = frame.data.slice();
	this.frameQueue.push(this.latestFrame);
  }

  getLatest(): Uint8Array | null {
	return this.latestFrame;
  }

  getQueued(): Uint8Array[] {
	const q = this.frameQueue;
	this.frameQueue = [];
	return q;
  }

  clearQueue(): void {
	this.frameQueue = [];
  }
}


