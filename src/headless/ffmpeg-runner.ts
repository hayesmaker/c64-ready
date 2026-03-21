/**
 * Minimal FFmpeg runner stub for headless MVP.
 *
 * This file provides a very small wrapper around child_process spawn to demonstrate
 * how frames/audio could be piped to an ffmpeg process. For the MVP we expose a
 * start/stop API but do not implement the full piping logic — this keeps the
 * library safe to run in browser builds while remaining useful in Node.
 */

export class FFmpegRunner {
  private proc: any = null;

  /**
   * Start ffmpeg with the provided args. Returns true if spawn succeeded.
   * In browser builds this will be a no-op and return false.
   */
  start(args: string[]): boolean {
	try {
	  // Lazy require so browser builds don't attempt to bundle child_process
	  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
	  const child = require('child_process');
	  this.proc = child.spawn('ffmpeg', args, { stdio: 'ignore' });
	  return !!this.proc;
	} catch (err) {
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


