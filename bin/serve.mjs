#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hayesmaker
// See LICENSE in the project root for full license information.
/**
 * c64-ready — browser player CLI
 *
 * Serves the pre-built C64 browser player from the package's dist/ directory. Pass a
 * game file to boot the player straight into it.
 *
 * Usage:
 *   c64-ready [game-file] [--port <n>] [--host] [--open] [--help]
 *
 * Examples:
 *   npx c64-ready
 *   npx c64-ready build/main.prg --open
 *   npx c64-ready --port 8080 --host
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HELP,
  parseServeArgs,
  createPlayerServer,
  playerPath,
  openInBrowser,
} from '../src/headless/player-server.mjs';

const PKG_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// Vite builds the app to dist/ with base '/c64-ready/'; dist/index.html is the entry point.
const DIST_DIR = join(PKG_ROOT, 'dist');

let opts;
try {
  opts = parseServeArgs(process.argv.slice(2));
} catch (e) {
  console.error(`c64-ready: ${e.message} (see --help)`);
  process.exit(1);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

if (!existsSync(join(DIST_DIR, 'index.html'))) {
  console.error(
    `Error: built player not found at ${join(DIST_DIR, 'index.html')}\n` +
      'Run `npm run build` inside the c64-ready package first, or install a published release.',
  );
  process.exit(1);
}

const server = createPlayerServer({ distDir: DIST_DIR, gameFile: opts.file });

server.listen(opts.port, opts.host ? '0.0.0.0' : '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://localhost:${port}${playerPath(opts.file)}`;
  console.log(`\n  C64 Ready player is running.\n`);
  if (opts.file) console.log(`  Game:      ${opts.file}  (reload the page after rebuilding)`);
  console.log(`  ➜  Local:   ${url}`);
  if (opts.host) {
    console.log(`  ➜  Network: http://<this-machine's-ip>:${port}${playerPath(opts.file)}`);
  }
  console.log(`\n  Controls: arrow keys = joystick, Z or left Ctrl = fire, gamepads work too.`);
  console.log(`  Press Ctrl+C to stop.\n`);
  if (opts.open) openInBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: port ${opts.port} is already in use. Try --port <other> (or --port 0).`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
