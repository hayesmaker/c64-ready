#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hayesmaker
// See LICENSE in the project root for full license information.
/**
 * c64-ready — browser player CLI
 *
 * Serves the pre-built C64 browser player from the package's dist/ directory
 * using a lightweight static HTTP server. Open the printed URL in any modern
 * browser to play.
 *
 * Usage:
 *   c64-ready [options]
 *
 * Options:
 *   --port <n>   HTTP port to listen on  (default: 5173)
 *   --host       Bind to 0.0.0.0 instead of localhost
 *   --help       Show this help
 *
 * Examples:
 *   # Serve on default port (installed globally or via npx)
 *   npx c64-ready
 *
 *   # Custom port, accessible on the local network
 *   npx c64-ready --port 8080 --host
 */

import { createServer } from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { extname, join, resolve, normalize } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
c64-ready — headless-free browser player

Usage:
  c64-ready [--port <n>] [--host] [--help]

Options:
  --port <n>   HTTP port  (default: 5173)
  --host       Bind to 0.0.0.0 so the player is reachable on your LAN
  --help       Show this help

Examples:
  npx c64-ready
  npx c64-ready --port 8080 --host
`.trim());
  process.exit(0);
}

const portIdx = argv.indexOf('--port');
const port = portIdx !== -1 ? parseInt(argv[portIdx + 1], 10) : 5173;
const bindAll = argv.includes('--host');
const hostname = bindAll ? '0.0.0.0' : '127.0.0.1';

// ---------------------------------------------------------------------------
// Locate the built dist/ directory
// ---------------------------------------------------------------------------
// Vite builds to dist/ with base '/c64-ready/'.
// The real app entry point is dist/index.html — assets are at dist/assets/*.
// dist/c64-ready/ is just the public/c64-ready/ static folder copied verbatim;
// it is NOT the built app.
const DIST_DIR = join(PKG_ROOT, 'dist');
const APP_ENTRY = join(DIST_DIR, 'index.html');

if (!existsSync(APP_ENTRY)) {
  console.error(
    `Error: built player not found at ${APP_ENTRY}\n` +
    `Run \`npm run build\` inside the c64-ready package first, or install a published release.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.ts':   'application/javascript',
  '.css':  'text/css',
  '.wasm': 'application/wasm',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.crt':  'application/octet-stream',
  '.d64':  'application/octet-stream',
  '.json': 'application/json',
  '.ttf':  'font/ttf',
  '.map':  'application/json',
};

// ---------------------------------------------------------------------------
// Static server
// ---------------------------------------------------------------------------
const server = createServer((req, res) => {
  // Strip query string and decode URI
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

  // Route the app root: /, /c64-ready, /c64-ready/ → dist/index.html
  if (
    urlPath === '/' ||
    urlPath === '/c64-ready' ||
    urlPath === '/c64-ready/'
  ) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(APP_ENTRY).pipe(res);
    return;
  }

  // All other requests are resolved against dist/ directly.
  // Vite bakes base='/c64-ready/' into all asset URLs, so strip that prefix
  // before resolving so the path maps into dist/ correctly:
  //   /c64-ready/assets/index-xxx.js  → dist/assets/index-xxx.js
  //   /c64.wasm                       → dist/c64.wasm
  const stripped = urlPath.startsWith('/c64-ready/') ? urlPath.slice('/c64-ready/'.length) : urlPath;
  const relative = stripped.startsWith('/') ? stripped.slice(1) : stripped;
  const filePath = resolve(DIST_DIR, normalize(relative));

  // Path traversal guard
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback for any unmatched path
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(APP_ENTRY).pipe(res);
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  createReadStream(filePath).pipe(res);
});

server.listen(port, hostname, () => {
  const displayHost = bindAll ? '0.0.0.0' : 'localhost';
  console.log(`\n  C64 Ready player is running.\n`);
  console.log(`  ➜  Local:   http://localhost:${port}/c64-ready/`);
  if (bindAll) {
    console.log(`  ➜  Network: http://${displayHost}:${port}/c64-ready/`);
  }
  console.log(`\n  Open the URL above in a modern browser.\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: port ${port} is already in use. Try --port <other>`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

