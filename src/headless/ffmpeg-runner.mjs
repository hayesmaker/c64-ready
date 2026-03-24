#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import net from 'net';

export class FFmpegRunner {
  proc = null;
  stdin = null;
  outputPath = null;
  _stderr = '';
  _exitCode = null;
  _audio = false;
  _sampleRate = 44100;
  _audioChunks = [];
  _verbose = false;
  _isUrl = false;
  _outPath = null;
  _fps = 50;
  _width = 384;
  _height = 272;
  _videoTempPath = null;

  // ── Live-audio (FIFO) state ───────────────────────────────────────────────
  // Strategy B uses a named pipe (FIFO) for audio delivery.
  // Node opens the write end; ffmpeg opens the read end via a file path.
  // This is kernel-synchronised — no net.Server race, no unix socket.
  _audioFifoPath = null;  // path to the FIFO
  _audioFifoFd = null;    // write-end file descriptor (opened after ffmpeg starts)
  _audioFifoStream = null; // WriteStream wrapping the fd
  _liveAudio = false;

  // ── Process health ────────────────────────────────────────────────────────
  _diedResolve = null;
  died = new Promise((resolve) => { this._diedResolve = resolve; });

  async start(options = {}) {
    const width      = options.width  || 384;
    const height     = options.height || 272;
    const fps        = options.fps    || 60;
    const verbose    = !!options.verbose;
    const audio      = !!options.audio;
    const sampleRate = options.sampleRate || 44100;

    this._audio      = audio;
    this._sampleRate = sampleRate;
    this._audioChunks = [];
    this._verbose    = verbose;
    this._fps        = fps;
    this._width      = width;
    this._height     = height;
    this._liveAudio  = false;
    this._exitCode   = null;
    this._stderr     = '';
    this._audioFifoPath   = null;
    this._audioFifoFd     = null;
    this._audioFifoStream = null;

    // Reset died promise for this run
    this.died = new Promise((resolve) => { this._diedResolve = resolve; });

    const isUrl = typeof options.output === 'string' && /^[a-zA-Z]+:\/\//.test(options.output);
    const outPath = isUrl
      ? options.output
      : path.resolve(options.output || path.join(process.cwd(), 'temp', `c64-record-${Date.now()}.mp4`));

    if (!isUrl) {
      try { await fs.mkdir(path.dirname(outPath), { recursive: true }); } catch (e) {}
    }

    this._isUrl   = isUrl;
    this._outPath = outPath;

    // ── Raw mode ─────────────────────────────────────────────────────────────
    if (options.raw) {
      try {
        this._raw = true;
        this.outputPath = outPath;
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        this._stream = fsSync.createWriteStream(outPath, { flags: 'w' });
        return true;
      } catch (e) {
        this._stderr = `raw-open-failed: ${String(e)}`;
        return false;
      }
    }

    // ── Strategy ──────────────────────────────────────────────────────────────
    // A) No audio (file or URL):
    //    Single pass — video-only stdin pipe → output file/URL.
    //    For file output with --duration this is fine.
    //    For URL/RTMP without audio this is the simple path.
    //
    // B) With audio (file or URL):
    //    Single pass with FIFO audio — video on stdin, audio on named FIFO.
    //    ffmpeg reads both in real-time, encoding at exactly the rate frames
    //    arrive. This is the ONLY correct approach for keeping A/V in sync:
    //    the FIFO backpressure means ffmpeg never runs faster than Node feeds it.
    //    (Two-pass was previously used for file+audio but caused fast video
    //    because pass-1 encoded to a temp file at maximum speed.)

    if (audio) {
      // ── Strategy B: single-pass FIFO audio (file or URL) ─────────────────

      // For RTMP outputs: verify host is TCP-reachable before spawning ffmpeg.
      if (isUrl && /^rtmps?:\/\//i.test(outPath)) {
        const rtmpMatch = outPath.match(/^rtmps?:\/\/([^/:]+):?(\d+)?/i);
        if (rtmpMatch) {
          const host = rtmpMatch[1];
          const port = parseInt(rtmpMatch[2] || '1935', 10);
          const maxWaitMs = 30000;
          const probeIntervalMs = 1000;
          let waited = 0;
          if (verbose) console.error(`[ffmpeg-runner] probing RTMP host ${host}:${port}...`);
          while (waited < maxWaitMs) {
            const reachable = await new Promise((resolve) => {
              const s = new net.Socket();
              s.setTimeout(2000);
              s.once('connect', () => { s.destroy(); resolve(true); });
              s.once('error', () => { s.destroy(); resolve(false); });
              s.once('timeout', () => { s.destroy(); resolve(false); });
              s.connect(port, host);
            });
            if (reachable) {
              if (verbose) console.error(`[ffmpeg-runner] RTMP host ${host}:${port} reachable — waiting 5s for NMS to stabilise`);
              await new Promise((r) => setTimeout(r, 5000));
              break;
            }
            if (verbose) console.error(`[ffmpeg-runner] RTMP host not ready, retrying in ${probeIntervalMs}ms...`);
            await new Promise((r) => setTimeout(r, probeIntervalMs));
            waited += probeIntervalMs;
          }
          if (waited >= maxWaitMs) {
            console.error(`[ffmpeg-runner] RTMP host ${host}:${port} unreachable after ${maxWaitMs}ms`);
          }
        }
      }

      // Use /dev/fd/3 instead of a FIFO file.
      // A true pipe (fd3) is non-seekable — ffmpeg can't seek it, so it won't
      // try to re-read from the start after probing, avoiding the "no packets"
      // error that occurs when using a FIFO path with file-based output.
      const args = [];
      if (!verbose) args.push('-hide_banner', '-nostats', '-loglevel', 'warning');
      // Skip input probing — formats are fully specified so probing only adds latency.
      args.push('-probesize', '32', '-analyzeduration', '0');
      // For URL outputs (RTMP), -re reads the input at its native frame rate,
      // pacing the stream output at exactly the target fps instead of encoding
      // as fast as possible and bursting frames to the RTMP server.
      if (isUrl) args.push('-re');
      // Video input: stdin (fd0)
      args.push(
        '-thread_queue_size', '512',
        '-f', 'rawvideo', '-pix_fmt', 'rgba',
        '-s', `${width}x${height}`, '-r', String(fps),
        '-i', 'pipe:0',
      );
      // Audio input: fd3 pipe
      args.push(
        '-thread_queue_size', '512',
        '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1',
        '-i', 'pipe:3',
      );
      // Encoders
      args.push(
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-g', String(Math.max(1, Math.round(fps))),
        '-c:a', 'aac', '-b:a', '128k',
      );
      // Output format + destination
      if (isUrl) {
        args.push('-f', 'flv');
      }
      args.push('-y', outPath);

      if (verbose) console.error(`[ffmpeg-runner] strategy B (pipe audio fd3, ${isUrl ? 'rtmp' : 'file'}):`, args.join(' '));

      // Spawn with 4 stdio streams: [stdin, stdout, stderr, audioWrite]
      this.proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
      this.stdin = this.proc.stdin;
      this.outputPath = outPath;
      this._liveAudio = true;

      // fd3 is the audio pipe write end — store it as _audioFifoStream for writeFrame()
      const audioWritePipe = this.proc.stdio[3];
      if (audioWritePipe) {
        audioWritePipe.on('error', () => {});
        this._audioFifoStream = audioWritePipe;
        if (verbose) console.error('[ffmpeg-runner] audio pipe fd3 ready');
      }

      // Clean up FIFO path tracking (not used for pipe mode)
      this._audioFifoPath = null;
      this._audioFifoFd = null;

      this.proc.on('error', (err) => { this._stderr += `\nspawn error: ${String(err)}`; try { this.stdin = null; } catch (e) {} });
      this.proc.stdin && this.proc.stdin.on('error', () => {});
      try {
        this.proc.stdout && this.proc.stdout.on('data', (d) => { this._stderr += String(d); if (verbose) process.stdout.write(d); });
        this.proc.stderr && this.proc.stderr.on('data', (d) => { this._stderr += String(d); if (verbose) process.stderr.write(d); });
      } catch (e) {}
      this.proc.on('close', (code) => {
        this._exitCode = code;
        try { this.stdin = null; } catch (e) {}
        if (this._diedResolve) { this._diedResolve(code); this._diedResolve = null; }
        if (code !== 0 && code !== null) {
          console.error(`[ffmpeg-runner] ffmpeg exited unexpectedly (code ${code}): ${this._stderr.slice(-400)}`);
        }
        // Audio pipe (fd3) is owned by the child process — just null the ref.
        this._audioFifoStream = null;
        this._audioFifoFd = null;
      });
      try { this.proc.stdin.setMaxListeners(100); } catch (e) {}

      // No silent pre-prime needed: ffmpeg reads video (pipe:0) and audio
      // (pipe:3) on independent threads, so neither blocks the other at
      // startup. Previously 20 silent frames were written here, but that
      // created a 20-frame audio lead that made audio_duration > video_duration
      // in the output file, causing video to appear to play back too fast.

      return !!this.proc && !!this.proc.pid;
    }

    // ── Strategy A: video-only single pass ────────────────────────────────
    // No audio — simple stdin pipe to output. For file output the loop's
    // FPS throttle (setTimeout) controls playback speed.
    const args = [];
    if (!verbose) args.push('-hide_banner', '-nostats', '-loglevel', 'warning');
    args.push(
      '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-s', `${width}x${height}`, '-r', String(fps),
      '-i', 'pipe:0',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-g', String(Math.max(1, Math.round(fps))),
      '-an',
    );
    if (isUrl) args.push('-f', 'flv');
    args.push('-y', outPath);

    if (verbose) console.error(`[ffmpeg-runner] strategy A (video-only, ${isUrl ? 'rtmp' : 'file'}):`, args.join(' '));

    this.proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.stdin = this.proc.stdin;
    this.outputPath = outPath;
    this._stderr = '';
    this._exitCode = null;

    this.proc.on('error', (err) => { this._stderr += `\nspawn error: ${String(err)}`; try { this.stdin = null; } catch (e) {} });
    this.proc.stdin && this.proc.stdin.on('error', () => {});
    try {
      this.proc.stdout && this.proc.stdout.on('data', (d) => { this._stderr += String(d); if (verbose) process.stdout.write(d); });
      this.proc.stderr && this.proc.stderr.on('data', (d) => { this._stderr += String(d); if (verbose) process.stderr.write(d); });
    } catch (e) {}
    this.proc.on('close', (code) => {
      this._exitCode = code;
      try { this.stdin = null; } catch (e) {}
      if (this._diedResolve) { this._diedResolve(code); this._diedResolve = null; }
      if (code !== 0 && code !== null) {
        console.error(`[ffmpeg-runner] ffmpeg exited unexpectedly (code ${code}): ${this._stderr.slice(-400)}`);
      }
    });
    try { this.proc.stdin.setMaxListeners(100); } catch (e) {}

    return !!this.proc && !!this.proc.pid;
  }

  // ── Frame write ───────────────────────────────────────────────────────────

  /** Returns true if the ffmpeg process is still running. */
  isAlive() {
    return !!(this.proc && this._exitCode === null);
  }

  writeFrame(videoFrame, audioChunk) {
    if (this._raw) {
      try {
        if (this._stream && !this._stream.destroyed)
          this._stream.write(Buffer.from(videoFrame.buffer, videoFrame.byteOffset, videoFrame.byteLength));
      } catch (e) {}
      return Promise.resolve(true);
    }

    // If ffmpeg process has exited, surface the error so the caller can abort
    if (this.proc && this._exitCode !== null) {
      return Promise.reject(new Error(`ffmpeg process exited (code ${this._exitCode})`));
    }

    // Audio handling — write BEFORE video so it's in the kernel pipe buffer
    // when ffmpeg looks for matching audio to interleave with the video frame.
    if (this._audio && audioChunk) {
      if (this._liveAudio && this._audioFifoStream && !this._audioFifoStream.destroyed) {
        try {
          this._audioFifoStream.write(
            Buffer.from(audioChunk.buffer, audioChunk.byteOffset, audioChunk.byteLength)
          );
        } catch (e) {}
      } else if (!this._liveAudio) {
        this._audioChunks.push(
          Buffer.from(audioChunk.buffer, audioChunk.byteOffset, audioChunk.byteLength)
        );
      }
    }

    // Video: write to stdin.
    //
    // Strategy B (liveAudio): fire-and-forget for video.
    //   With two pipe inputs, awaiting drain deadlocks: ffmpeg's audio reader
    //   thread (pipe:3) is slow to open, so while we block on the video stdin
    //   drain the audio thread hasn't started reading yet. ffmpeg never drains
    //   video stdin → watchdog kills ffmpeg.
    //   Real-time pacing is enforced by:
    //     - RTMP: -re flag makes ffmpeg read at native frame rate
    //     - File: -r fps bakes correct timestamps; player decodes at real speed
    //     - Both: the headless loop's setTimeout throttle keeps us near target fps
    //
    // Strategy A (video-only): await drain — provides real backpressure.
    return new Promise((resolve) => {
      if (!this.stdin || this.stdin.destroyed) return resolve(false);
      try {
        const vBuf = Buffer.from(videoFrame.buffer, videoFrame.byteOffset, videoFrame.byteLength);
        if (this._liveAudio) {
          // Fire-and-forget: write and resolve immediately so the headless
          // loop's setTimeout can throttle to target fps.
          this.stdin.write(vBuf);
          setImmediate(() => resolve(true));
          return;
        }
        // Strategy A: drain-based backpressure
        const flushed = this.stdin.write(vBuf);
        if (!flushed) {
          let resolved = false;
          const done = (val) => {
            if (resolved) return;
            resolved = true;
            clearInterval(poll);
            clearTimeout(watchdog);
            resolve(val);
          };
          const poll = setInterval(() => {
            if (this._exitCode !== null) done(false);
          }, 100);
          const watchdog = setTimeout(() => {
            if (this.proc && this._exitCode === null) {
              if (this._verbose) console.error('[ffmpeg-runner] stdin drain timeout — killing ffmpeg');
              try { this.proc.kill('SIGTERM'); } catch (e) {}
            }
            done(false);
          }, 15000);
          this.stdin.once('drain', () => done(true));
        } else {
          setImmediate(() => resolve(true));
        }
      } catch (e) { resolve(false); }
    });
  }

  // ── Legacy helpers ───────────────────────────────────────────────────────

  tryWrite(frame) {
    if (this._raw) {
      try {
        if (!this._stream || this._stream.destroyed) return false;
        this._stream.write(Buffer.from(frame.buffer ?? frame, frame.byteOffset, frame.byteLength));
        return true;
      } catch (e) { return false; }
    }
    if (!this.stdin || this.stdin.destroyed) return false;
    try {
      this.stdin.write(Buffer.from(frame.buffer ?? frame, frame.byteOffset, frame.byteLength));
      return true;
    } catch (e) { return false; }
  }

  tryWriteAudio(samples) {
    if (!this._audio) return false;
    if (this._liveAudio && this._audioFifoStream && !this._audioFifoStream.destroyed) {
      try {
        this._audioFifoStream.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
        return true;
      } catch (e) { return false; }
    }
    this._audioChunks.push(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    return true;
  }

  // ── Stop ─────────────────────────────────────────────────────────────────

  async stop() {
    if (this._raw) {
      if (this._stream) {
        return new Promise((resolve) => {
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

    // ── Strategy B cleanup ────────────────────────────────────────────────
    if (this._liveAudio) {
      // Audio pipe (fd3) is owned by the child — end it to signal EOF to ffmpeg.
      try { if (this._audioFifoStream && !this._audioFifoStream.destroyed) this._audioFifoStream.end(); } catch (e) {}
      this._audioFifoStream = null;
      this._audioFifoFd = null;
    }

    // End video stdin
    try { this.stdin.end(); } catch (e) {}

    await new Promise((resolve, reject) => {
      const onClose = () => {
        const code = this._exitCode;
        const stderr = this._stderr;
        this.proc = null;
        this.stdin = null;
        if (code !== 0 && code !== null)
          return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 1000)}`));
        resolve();
      };
      if (this._exitCode !== null) return onClose();
      this.proc.once('close', onClose);
      setTimeout(() => { if (this.proc) try { this.proc.kill('SIGTERM'); } catch (e) {} }, 10000);
    });

    if (this._liveAudio) return this._outPath;

    // Strategy A (video-only): ffmpeg wrote directly to outPath, nothing more to do.
    return this._outPath;
  }
}

export default FFmpegRunner;

