// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hayesmaker
// See LICENSE in the project root for full license information.
/**
 * player-server.mjs — static HTTP server for the built browser player (`c64-ready` CLI).
 *
 * Optionally serves one local game file (.prg/.d64/.crt/.c64/…) next to the player so the
 * player can boot straight into it via `?game=`. The file is read from disk on every
 * request, so reloading the page picks up a fresh build.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, normalize, sep } from 'node:path';
import { spawn } from 'node:child_process';

export const BASE_PATH = '/c64-ready/';
export const LOCAL_GAME_PREFIX = `${BASE_PATH}local/`;
export const GAME_EXTENSIONS = ['.prg', '.d64', '.crt', '.c64', '.s64', '.snapshot'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

export const HELP = `
c64-ready — serve the C64 browser player

Usage:
  c64-ready [game-file] [--port <n>] [--host] [--open] [--help]

Arguments:
  game-file    A .prg, .d64, .crt or .c64 snapshot to boot straight into. It is
               re-read on every page load, so rebuild and refresh to see changes.

Options:
  --port <n>   HTTP port  (default: 5173, 0 = any free port)
  --host       Bind to 0.0.0.0 so the player is reachable on your LAN
  --open       Open the player in your default browser
  --help       Show this help

Examples:
  npx c64-ready
  npx c64-ready build/main.prg --open
  npx c64-ready --port 8080 --host
`.trim();

/** Parse CLI arguments. Throws on invalid input. */
export function parseServeArgs(argv) {
  const o = { help: false, port: 5173, host: false, open: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--host') o.host = true;
    else if (a === '--open') o.open = true;
    else if (a === '--port') {
      const v = argv[++i];
      const n = Number(v);
      if (v === undefined || !Number.isInteger(n) || n < 0 || n > 65535) {
        throw new Error(`--port needs a number between 0 and 65535`);
      }
      o.port = n;
    } else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else if (o.file) throw new Error(`Only one game file can be served (got ${o.file} and ${a})`);
    else o.file = a;
  }
  if (o.file) {
    const abs = resolve(o.file);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`File not found: ${o.file}`);
    const ext = extname(abs).toLowerCase();
    if (!GAME_EXTENSIONS.includes(ext)) {
      throw new Error(
        `Unsupported file type ${ext || '(none)'}: expected ${GAME_EXTENSIONS.join(', ')}`,
      );
    }
    o.file = abs;
  }
  return o;
}

/** The URL path that serves the local game file. */
export function localGamePath(file) {
  return `${LOCAL_GAME_PREFIX}${encodeURIComponent(basename(file))}`;
}

/** The player URL (path + query) that boots into the local game file. */
export function playerPath(file) {
  // '/' is legal in a query string, and the file name is already escaped by localGamePath().
  return file ? `${BASE_PATH}?game=${localGamePath(file)}` : BASE_PATH;
}

/**
 * Create (but do not start) the player HTTP server.
 * @param {{ distDir: string, gameFile?: string | null }} opts
 */
export function createPlayerServer({ distDir, gameFile = null }) {
  const DIST_DIR = resolve(distDir);
  const APP_ENTRY = join(DIST_DIR, 'index.html');
  // Compared after decoding, so it matches however the browser escapes the name.
  const gamePath = gameFile ? `${LOCAL_GAME_PREFIX}${basename(gameFile)}` : null;

  const sendEntry = (res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(APP_ENTRY).pipe(res);
  };

  return createServer((req, res) => {
    const rawPath = (req.url ?? '/').split('?')[0];
    let urlPath;
    try {
      urlPath = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    // The one local game file, if any. Always re-read; never cached.
    if (gamePath && urlPath === gamePath) {
      if (!existsSync(gameFile)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Game file no longer exists: ${gameFile}`);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': statSync(gameFile).size,
        'Cache-Control': 'no-store',
      });
      createReadStream(gameFile).pipe(res);
      return;
    }

    // Anything else under /local/ is a game the player asked for that we don't have.
    // A 404 makes the player report it, instead of trying to boot the HTML fallback.
    if (urlPath.startsWith(LOCAL_GAME_PREFIX)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    // App root: /, /c64-ready, /c64-ready/ → dist/index.html
    if (urlPath === '/' || urlPath === '/c64-ready' || urlPath === BASE_PATH) {
      sendEntry(res);
      return;
    }

    // Everything else resolves against dist/. Vite bakes base='/c64-ready/' into asset
    // URLs, so strip it: /c64-ready/assets/x.js → dist/assets/x.js.
    const stripped = urlPath.startsWith(BASE_PATH) ? urlPath.slice(BASE_PATH.length) : urlPath;
    const relative = stripped.startsWith('/') ? stripped.slice(1) : stripped;
    const filePath = resolve(DIST_DIR, normalize(relative));

    if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      sendEntry(res); // SPA fallback
      return;
    }

    const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    createReadStream(filePath).pipe(res);
  });
}

/** Open a URL in the default browser. Best effort: failures are reported, never thrown. */
export function openInBrowser(url, { platform = process.platform, spawnFn = spawn } = {}) {
  const [cmd, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawnFn(cmd, args, { stdio: 'ignore', detached: true });
    child.on?.('error', () => console.error(`  (could not open a browser: open ${url} manually)`));
    child.unref?.();
  } catch {
    console.error(`  (could not open a browser: open ${url} manually)`);
  }
}
