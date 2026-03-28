#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hayesmaker
// See LICENSE in the project root for full license information.
/**
 * c64-headless — CLI entry point
 *
 * Usage:
 *   c64-headless --wasm <path/to/c64.wasm> [options]
 *
 * Options:
 *   --wasm <path>        Path to c64.wasm            [default: public/c64.wasm]
 *   --game <path>        Cartridge / disk image to load
 *   --no-game            Boot to BASIC prompt (no game)
 *   --record             Stream/record frames via ffmpeg
 *   --output <path|url>  Output file or rtmp:// URL   [default: temp/c64-record-<ts>.mp4]
 *   --duration <secs>    Recording duration in seconds [default: 60]
 *   --fps <n>            Frame rate                   [default: 50  (PAL)]
 *   --input              Start WebSocket input server for remote control
 *   --ws-port <n>        WebSocket server port        [default: 9001]
 *   --verbose            Print per-frame diagnostics
 *   --help               Show this help
 *
 * Prerequisites:
 *   1. ffmpeg must be on PATH (for --record)
 *   2. Build the JS wrapper once:  npx tsc -p tsconfig.build2.json
 *
 * Examples:
 *   # Stream to RTMP indefinitely
 *   c64-headless --wasm public/c64.wasm --record --output rtmp://localhost:1935/live/c64 --duration 3600 --no-game
 *
 *   # Record 30 seconds to a file
 *   c64-headless --wasm public/c64.wasm --record --output out.mp4 --duration 30 --no-game
 *
 *   # Load a game and stream
 *   c64-headless --wasm public/c64.wasm --game games/mygame.crt --record --output rtmp://localhost:1935/live/c64 --duration 3600
 */

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  const help = `
c64-headless — headless Commodore 64 emulator

Usage:
  c64-headless [options]

Options:
  --wasm <path>        Path to c64.wasm  (default: public/c64.wasm)
  --game <path>        Cartridge or disk image to load
  --no-game            Boot to BASIC prompt without loading a game
  --record             Encode frames with ffmpeg
  --audio              Include SID audio in the recording / stream (requires --record)
  --output <path|url>  Output file path or rtmp:// stream URL
  --duration <secs>    Recording duration in seconds  (omit for endless streaming)
  --fps <n>            Target frame rate  (default: 50 for PAL)
  --webrtc             Start a WebRTC streaming server (low-latency; replaces RTMP+flv.js)
  --webrtc-port <n>    WebRTC signalling + player HTTP port  (default: 9002)
  --input              Start WebSocket input server for remote control
  --ws-port <n>        WebSocket server port  (default: 9001)
  --verbose            Print per-frame diagnostics to stderr
  --help               Show this help

Prerequisites:
  ffmpeg must be on PATH for --record
  @roamhq/wrtc must be installed for --webrtc  (npm install @roamhq/wrtc)
  ws npm package must be installed for --input (it is a dependency of c64-ready)

Examples:
  # Low-latency WebRTC stream (open http://localhost:9002 in a browser)
  c64-headless --wasm public/c64.wasm --no-game --webrtc \\
    --webrtc-port 9002 --input --ws-port 9001 --fps 50

  # RTMP live stream (5 minutes)
  c64-headless --wasm public/c64.wasm --no-game --record \\
    --output rtmp://localhost:1935/live/c64 --duration 300

  # Record to file (30 seconds)
  c64-headless --wasm public/c64.wasm --no-game --record \\
    --output out.mp4 --duration 30

  # WebRTC + simultaneous RTMP (both active at once)
  c64-headless --wasm public/c64.wasm --game game.crt --webrtc \\
    --record --output rtmp://localhost:1935/live/c64 --input --ws-port 9001
`.trim();
  console.log(help);
  process.exit(0);
}

import { runHeadless } from '../src/headless/headless-cli.mjs';

const res = await runHeadless({ argv });

if (Array.isArray(res.output)) {
  for (const line of res.output) console.log(line);
} else if (res.output && res.output !== 'help') {
  console.log(res.output);
}

if (!res.ok) {
  if (res.err === 'no-wasm') {
    console.error('Error: no c64.wasm found. Provide --wasm <path>');
  } else if (res.err === 'ffmpeg-start-failed') {
    console.error('Error: ffmpeg failed to start. Is ffmpeg on your PATH?');
  } else if (res.err) {
    console.error(`Error: ${res.err}`);
  }
  process.exit(1);
}

// Force exit: native addons (@roamhq/wrtc) keep the event loop alive
// even after all work is done. This is safe — all cleanup already ran above.
process.exit(0);

