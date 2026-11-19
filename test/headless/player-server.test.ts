// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  parseServeArgs,
  createPlayerServer,
  localGamePath,
  playerPath,
  openInBrowser,
} from '../../src/headless/player-server.mjs';

describe('player server: argument parsing', () => {
  let dir: string;
  let prg: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c64-serve-args-'));
    prg = path.join(dir, 'game.prg');
    await fs.writeFile(prg, Uint8Array.from([0x01, 0x08, 0x00]));
    await fs.writeFile(path.join(dir, 'notes.txt'), 'hi');
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it('defaults to port 5173 on localhost with no game', () => {
    expect(parseServeArgs([])).toEqual({
      help: false,
      port: 5173,
      host: false,
      open: false,
      file: null,
    });
  });

  it('accepts a game file and flags in any order', () => {
    const o = parseServeArgs(['--open', prg, '--port', '0', '--host']);
    expect(o).toEqual({ help: false, port: 0, host: true, open: true, file: prg });
  });

  it('rejects missing files, unsupported types, bad ports and extra files', () => {
    expect(() => parseServeArgs([path.join(dir, 'nope.prg')])).toThrow(/File not found/);
    expect(() => parseServeArgs([path.join(dir, 'notes.txt')])).toThrow(
      /Unsupported file type \.txt/,
    );
    expect(() => parseServeArgs(['--port', 'abc'])).toThrow(/--port/);
    expect(() => parseServeArgs(['--port', '70000'])).toThrow(/--port/);
    expect(() => parseServeArgs([prg, prg])).toThrow(/Only one game file/);
    expect(() => parseServeArgs(['--nope'])).toThrow(/Unknown option/);
  });

  it('builds a readable player URL with the file name escaped', () => {
    expect(playerPath(null)).toBe('/c64-ready/');
    expect(playerPath('/x/build/main.prg')).toBe('/c64-ready/?game=/c64-ready/local/main.prg');
    expect(localGamePath('/x/my game&1.prg')).toBe('/c64-ready/local/my%20game%261.prg');
  });
});

describe('player server: HTTP routes', () => {
  let dir: string;
  let dist: string;
  let game: string;
  let base: string;
  let server: ReturnType<typeof createPlayerServer>;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c64-serve-'));
    dist = path.join(dir, 'dist');
    await fs.mkdir(path.join(dist, 'assets'), { recursive: true });
    await fs.writeFile(path.join(dist, 'index.html'), '<html>player</html>');
    await fs.writeFile(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    await fs.writeFile(path.join(dist, 'c64.wasm'), Uint8Array.from([0, 0x61, 0x73, 0x6d]));
    await fs.writeFile(path.join(dir, 'secret.txt'), 'secret');
    game = path.join(dir, 'my game.prg');
    await fs.writeFile(game, Uint8Array.from([0x01, 0x08, 0xaa]));

    server = createPlayerServer({ distDir: dist, gameFile: game });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('serves the player entry for the app root and unknown paths', async () => {
    for (const p of ['/', '/c64-ready', '/c64-ready/?game=x', '/somewhere/else']) {
      const res = await fetch(base + p);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<html>player</html>');
    }
  });

  it('serves built assets with the right MIME type', async () => {
    const js = await fetch(`${base}/c64-ready/assets/app.js`);
    expect(js.headers.get('content-type')).toBe('application/javascript');
    const wasm = await fetch(`${base}/c64.wasm`);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
  });

  it('serves the local game uncached, and re-reads it on every request', async () => {
    const url = base + localGamePath(game);
    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([0x01, 0x08, 0xaa]);

    await fs.writeFile(game, Uint8Array.from([0x01, 0x08, 0xbb, 0xcc]));
    const second = await fetch(url);
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([0x01, 0x08, 0xbb, 0xcc]);
  });

  it('returns 404 for other /local/ paths instead of the HTML fallback', async () => {
    const res = await fetch(`${base}/c64-ready/local/other.prg`);
    expect(res.status).toBe(404);
  });

  it('refuses to serve files outside dist/', async () => {
    // fetch() normalises "..", so send raw request paths with node:http.
    const rawStatus = (p: string) =>
      new Promise<number>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: new URL(base).port, path: p }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          })
          .on('error', reject);
      });
    expect(await rawStatus('/c64-ready/../secret.txt')).toBe(403);
    expect(await rawStatus('/c64-ready/..%2fsecret.txt')).toBe(403);
    expect(await rawStatus('/c64-ready/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).toBe(403);
  });
});

describe('player server: opening a browser', () => {
  it('uses the platform opener and never throws', () => {
    const calls: [string, string[]][] = [];
    const fakeSpawn = (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      return { on: () => {}, unref: () => {} };
    };
    openInBrowser('http://x/', { platform: 'linux', spawnFn: fakeSpawn as never });
    openInBrowser('http://x/', { platform: 'darwin', spawnFn: fakeSpawn as never });
    openInBrowser('http://x/', { platform: 'win32', spawnFn: fakeSpawn as never });
    expect(calls.map((c) => c[0])).toEqual(['xdg-open', 'open', 'cmd']);
    expect(() =>
      openInBrowser('http://x/', {
        platform: 'linux',
        spawnFn: (() => {
          throw new Error('no opener');
        }) as never,
      }),
    ).not.toThrow();
  });
});
