#!/usr/bin/env node
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
// When installed as a package the layout is: <pkg>/dist/c64-ready/index.html
// (Vite builds to dist/ with base '/c64-ready/'). When run from the repo
// root the same path applies.
const DIST_DIR = join(PKG_ROOT, 'dist');
const PLAYER_DIR = join(DIST_DIR, 'c64-ready');

if (!existsSync(PLAYER_DIR)) {
  console.error(
    `Error: built player not found at ${PLAYER_DIR}\n` +
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

  // Map '/' → '/index.html'
  if (urlPath === '/' || urlPath === '/c64-ready' || urlPath === '/c64-ready/') {
    urlPath = '/c64-ready/index.html';
  }

  // Resolve against dist root, prevent path traversal
  const relative = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
  const filePath = resolve(DIST_DIR, normalize(relative));

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback — serve the player index for any unknown path under /c64-ready/
    const fallback = join(PLAYER_DIR, 'index.html');
    if (existsSync(fallback)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      createReadStream(fallback).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';

  // WASM requires correct MIME — browsers reject it otherwise
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

