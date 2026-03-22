#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

export class FFmpegRunner {
  proc = null;
  stdin = null;
  outputPath = null;
  _stderr = '';
  _exitCode = null;
  _backpressure = false;

  /**
   * Start ffmpeg with options: { output, width, height, fps, duration }
   * Returns true if ffmpeg spawned successfully.
   */
  async start(options = {}) {
    const width = options.width || 384;
    const height = options.height || 272;
    const fps = options.fps || 60;
    const duration = options.duration || 60;
    const verbose = !!options.verbose;
    const isUrl = typeof options.output === 'string' && /^[a-zA-Z]+:\/\//.test(options.output);
    const outPath = isUrl ? options.output : path.resolve(options.output || path.join(process.cwd(), 'temp', `c64-record-${Date.now()}.mp4`));
    if (!isUrl) {
      try {
        await fs.mkdir(path.dirname(outPath), { recursive: true });
      } catch (e) {}
    }

    // By default suppress ffmpeg banner/stats unless verbose is requested.
    const args = [];
    if (!verbose) {
      args.push('-hide_banner', '-nostats', '-loglevel', 'warning');
    }
    args.push(
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${width}x${height}`,
      '-r', String(fps),
      '-i', '-',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      // Default to streaming-friendly encoder settings. These will be
      // skipped if the caller already supplies -c:v/-preset/-tune/-g.
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-g', String(Math.max(1, Math.round(fps))),
      '-y',
    );

    // When output is a network URL (e.g., rtmp://...), explicit format
    // 'flv' is required for RTMP. Insert it before the output path.
    if (isUrl) {
      args.push('-f', 'flv');
    }
    args.push(outPath);
    // If caller requested raw output, write frames directly to a file
    if (options.raw) {
      try {
        // create/overwrite file
        this._raw = true;
        this.outputPath = outPath;
        // ensure parent dir
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        this._stream = fsSync.createWriteStream(outPath, { flags: 'w' });
        this._stderr = '';
        this._exitCode = null;
        return true;
      } catch (e) {
        this._stderr = `raw-open-failed: ${String(e)}`;
        return false;
      }
    }

    // Log the ffmpeg command for debugging (visible when running the CLI
    // with --verbose). Spawn ffmpeg and inherit stdout/stderr so its logs
    // are visible in the terminal. Stdin remains a pipe for writing raw frames.
    try {
      if (verbose) console.error('[ffmpeg-runner] spawning ffmpeg with args:', args.join(' '));
    } catch (e) {}
    // Capture stdout/stderr so ffmpeg progress doesn't inherit to the
    // terminal by default. Forward to the terminal only when verbose.
    this.proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.stdin = this.proc.stdin;
    this.outputPath = outPath;
    this._stderr = '';
    this._exitCode = null;


    this.proc.on('error', (err) => {
      this._stderr += `\nffmpeg spawn error: ${String(err)}`;
      // Mark stdin as gone so callers won't attempt further writes
      try { this.stdin = null; } catch (e) {}
    });

    // Collect stdout/stderr from ffmpeg. ffmpeg writes progress and stats to
    // stderr; capture it and only forward to the user's terminal when
    // verbose mode is enabled.
    try {
      this.proc.stdout && this.proc.stdout.on('data', (chunk) => {
        const s = String(chunk);
        // keep a short in-memory log for error reporting
        this._stderr += s;
        if (verbose) process.stdout.write(s);
      });
      this.proc.stderr && this.proc.stderr.on('data', (chunk) => {
        const s = String(chunk);
        this._stderr += s;
        if (verbose) process.stderr.write(s);
      });
    } catch (e) {}

    // When ffmpeg exits, record the code and clear stdin so subsequent
    // write() calls become no-ops instead of attempting to write to a
    // destroyed stream which throws ERR_STREAM_DESTROYED.
    this.proc.on('close', (code) => {
      this._exitCode = code;
      try { this.stdin = null; } catch (e) {}
    });

    return !!this.proc && !!this.proc.pid;
  }

  /**
   * Write a single raw RGBA frame (Uint8Array) to ffmpeg stdin.
   * Handles backpressure by awaiting drain if write returns false.
   */
  async write(frame) {
    // If raw mode, write directly to file stream
    if (this._raw) {
      if (!this._stream || this._stream.destroyed) return false;
      return new Promise((resolve, reject) => {
        try {
          const ok = this._stream.write(Buffer.from(frame), (err) => {
            if (err) return reject(err);
            resolve(true);
          });
          if (!ok) this._stream.once('drain', () => resolve(true));
        } catch (err) {
          return reject(err);
        }
      });
    }
    // If stdin no longer available, avoid writing to destroyed stream
    if (!this.stdin || this.stdin.destroyed) return false;
    return new Promise((resolve, reject) => {
      try {
        const ok = this.stdin.write(Buffer.from(frame), (err) => {
          if (err) return reject(err);
          resolve(true);
        });
        if (!ok) {
          // mark backpressure and wait for drain
          this._backpressure = true;
          this.stdin.once('drain', () => {
            this._backpressure = false;
            resolve(true);
          });
        }
      } catch (err) {
        // If write throws (e.g., stream destroyed concurrently), return false
        return reject(err);
      }
    });
  }

  /**
   * Try to write synchronously to ffmpeg stdin. Returns true if the write
   * was accepted (or scheduled). Returns false if stdin is not available or
   * if the write failed synchronously. This function does not await drain so
   * callers can avoid blocking the emulator loop on ffmpeg backpressure.
   */
  tryWrite(frame) {
    if (this._raw) {
      try {
        if (!this._stream || this._stream.destroyed) return false;
        this._stream.write(Buffer.from(frame));
        return true;
      } catch (e) {
        return false;
      }
    }
    if (!this.stdin || this.stdin.destroyed) return false;
    try {
      const ok = this.stdin.write(Buffer.from(frame));
      if (!ok) {
        this._backpressure = true;
        this.stdin.once('drain', () => { this._backpressure = false; });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Stop ffmpeg gracefully and return a promise that resolves when process exits. */
  async stop() {
    // raw mode: close file stream and resolve when finished
    if (this._raw) {
      if (this._stream) {
        return new Promise((resolve, reject) => {
          this._stream.end(() => {
            this._stream = null;
            const out = this.outputPath;
            this.outputPath = null;
            resolve(out);
          });
        });
      }
      return;
    }

    if (!this.proc) return;
    try {
      // End stdin so ffmpeg finishes encoding
      this.stdin.end();
    } catch (e) {}
    return new Promise((resolve, reject) => {
      const onClose = () => {
        const code = this._exitCode;
        const stderr = this._stderr;
        this.proc = null;
        this.stdin = null;
        if (code !== 0 && code !== null) {
          const err = new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 1000)}`);
          return reject(err);
        }
        return resolve(this.outputPath);
      };

      if (this._exitCode !== null) {
        // already closed
        return onClose();
      }

      this.proc.once('close', onClose);

      // Fallback timeout: if ffmpeg doesn't exit within 10s after stdin end, resolve with warning
      setTimeout(() => {
        if (this.proc) {
          // attempt to kill gracefully
          try { this.proc.kill('SIGTERM'); } catch (e) {}
        }
      }, 10000);
    });
  }
}

export default FFmpegRunner;

