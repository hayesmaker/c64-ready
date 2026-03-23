/**
 * Minimal FFmpeg runner stub for headless MVP.
 *
 * This file provides a very small wrapper around child_process.spawn to demonstrate
 * how frames/audio could be piped to an ffmpeg process. For the MVP we expose a
 * start/stop API but do not implement the full piping logic — this keeps the
 * library safe to run in browser builds while remaining useful in Node.
 */

import { spawn, type ChildProcess } from 'child_process';

export class FFmpegRunner {
  private proc: ChildProcess | null = null;

  /**
   * Start ffmpeg with the provided args. Returns true if spawn succeeded.
   * In browser builds this will be a no-op and return false.
   */
  start(args: string[]): boolean {
    try {
      // Use Node's spawn import directly. This module is only used in
      // headless Node.js environments and should not be bundled into
      // browser builds.

      // If the user passed an RTMP (or similar) output URL, ensure we include
      // streaming-friendly encoder options unless the caller already provided
      // them. We look for a URL like rtmp:// and, if found, insert a sensible
      // default encoder config for low-latency live streaming.
      let finalArgs = args.slice();
      const outputIndex = finalArgs.findIndex((a) => a.startsWith('rtmp://'));

      if (outputIndex !== -1) {
        const hasPreset = finalArgs.some(
          (a) => a === '-preset' || a === '-tune' || a === '-g' || a === '-c:v',
        );
        if (!hasPreset) {
          // Insert before the output position
          const streamOpts = [
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-tune',
            'zerolatency',
            '-pix_fmt',
            'yuv420p',
            '-g',
            '50',
          ];
          finalArgs = finalArgs
            .slice(0, outputIndex)
            .concat(streamOpts)
            .concat(finalArgs.slice(outputIndex));
        }
      }

      // Spawn ffmpeg and show its stdout/stderr to aid debugging in Node.
      // Use a pipe for stdin so callers can write frames to ffmpeg if needed.
      this.proc = spawn('ffmpeg', finalArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
      return this.proc != null;
    } catch (_err) {
      // ignore spawn errors (ffmpeg missing or not available in environment)
      console.debug('[ffmpeg-runner] spawn failed', String(_err));
      return false;
    }
  }

  stop(): void {
    if (this.proc && typeof this.proc.kill === 'function') {
      this.proc.kill('SIGINT');
    }
    this.proc = null;
  }
}
