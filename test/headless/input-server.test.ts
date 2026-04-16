/**
 * Tests for src/headless/input-server.mjs
 *
 * Covers the behaviours added in the fix/input-lag-issue branch:
 *  - onCommand Promise-awaiting: cart-loaded / cart-detached / machine-reset are
 *    broadcast only AFTER the onCommand Promise resolves (not before).
 *  - cart-load-error is broadcast when onCommand rejects.
 *  - Non-host clients cannot issue emulator commands.
 *  - hello handshake carries expected fields.
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';

// Dynamic import so the ES module resolves in Vitest's Node context.
const { createInputServer } = await import('../../src/headless/input-server.mjs');

/** Open a WS connection and return the first message received (the hello). */
function connect(port: number): Promise<{ ws: WebSocket; hello: any }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('message', (raw: WebSocket.RawData) => {
      try {
        const hello = JSON.parse(raw.toString());
        resolve({ ws, hello });
      } catch (e) {
        reject(e);
      }
    });
    ws.once('error', reject);
  });
}

/** Send a JSON message on a WebSocket. */
function send(ws: WebSocket, msg: object): void {
  ws.send(JSON.stringify(msg));
}

/** Wait for the next message matching a predicate on a WebSocket. */
function nextMsg(ws: WebSocket, pred?: (m: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nextMsg timeout')), timeoutMs);
    function handler(raw: WebSocket.RawData) {
      const msg = JSON.parse(raw.toString());
      if (!pred || pred(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    }
    ws.on('message', handler);
  });
}

/** Collect all messages received on a WS within a time window. */
function collectMsgs(ws: WebSocket, windowMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const msgs: any[] = [];
    function handler(raw: WebSocket.RawData) {
      msgs.push(JSON.parse(raw.toString()));
    }
    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(msgs);
    }, windowMs);
  });
}

// Use a unique port per test to avoid bind conflicts when tests run in parallel.
let portCounter = 19100;
function nextPort() {
  return portCounter++;
}

describe('input-server', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close().catch(() => {})));
    servers.length = 0;
  });

  // ── Hello handshake ────────────────────────────────────────────────────────

  it('sends hello with expected fields on connect', async () => {
    const port = nextPort();
    const srv = createInputServer({ port, onInput: () => {} });
    servers.push(srv);

    const { ws, hello } = await connect(port);
    expect(hello.type).toBe('hello');
    expect(hello.protocol).toBe('c64-input');
    expect(hello.version).toBe(1);
    expect(hello.hostTaken).toBe(false);
    expect(hello.joystickBitmask).toMatchObject({
      up: 0x1,
      down: 0x2,
      left: 0x4,
      right: 0x8,
      fire: 0x10,
    });
    ws.close();
  });

  // ── cart-loaded sent AFTER onCommand Promise resolves ─────────────────────

  it('broadcasts cart-loaded only after the async onCommand Promise resolves for load-crt', async () => {
    const port = nextPort();
    const DELAY_MS = 80;
    const events: string[] = [];

    const srv = createInputServer({
      port,
      onInput: () => {},
      onCommand: (_cmd: any) =>
        new Promise<void>((res) => {
          // Record when onCommand fires, resolve after a delay.
          events.push('onCommand-start');
          setTimeout(() => {
            events.push('onCommand-done');
            res();
          }, DELAY_MS);
        }),
    });
    servers.push(srv);

    // Client A becomes host.
    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'alice' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    // Client B spectator — will receive the broadcast.
    const { ws: spectWs } = await connect(port);

    // Fire load-crt from the host.
    const cartData = Buffer.from([1, 2, 3, 4]).toString('base64');
    send(hostWs, { type: 'load-crt', filename: 'test.crt', data: cartData });

    // Wait for cart-loaded on the spectator side.
    await nextMsg(spectWs, (m) => m.type === 'cart-loaded');
    events.push('cart-loaded-received');

    // onCommand-done must appear BEFORE cart-loaded-received.
    const doneIdx = events.indexOf('onCommand-done');
    const loadedIdx = events.indexOf('cart-loaded-received');
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(loadedIdx).toBeGreaterThan(doneIdx);

    hostWs.close();
    spectWs.close();
  });

  // ── cart-detached sent AFTER onCommand Promise resolves ───────────────────

  it('broadcasts cart-detached only after the async onCommand Promise resolves for detach-crt', async () => {
    const port = nextPort();
    const DELAY_MS = 60;
    const events: string[] = [];

    const srv = createInputServer({
      port,
      onInput: () => {},
      onCommand: (_cmd: any) =>
        new Promise<void>((res) => {
          events.push('onCommand-start');
          setTimeout(() => {
            events.push('onCommand-done');
            res();
          }, DELAY_MS);
        }),
    });
    servers.push(srv);

    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'bob' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    const { ws: spectWs } = await connect(port);

    send(hostWs, { type: 'detach-crt' });
    await nextMsg(spectWs, (m) => m.type === 'cart-detached');
    events.push('cart-detached-received');

    const doneIdx = events.indexOf('onCommand-done');
    const detachedIdx = events.indexOf('cart-detached-received');
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(detachedIdx).toBeGreaterThan(doneIdx);

    hostWs.close();
    spectWs.close();
  });

  // ── machine-reset sent AFTER onCommand Promise resolves ───────────────────

  it('broadcasts machine-reset only after the onCommand Promise resolves for hard-reset', async () => {
    const port = nextPort();
    const DELAY_MS = 60;
    const events: string[] = [];

    const srv = createInputServer({
      port,
      onInput: () => {},
      onCommand: (_cmd: any) =>
        new Promise<void>((res) => {
          events.push('onCommand-start');
          setTimeout(() => {
            events.push('onCommand-done');
            res();
          }, DELAY_MS);
        }),
    });
    servers.push(srv);

    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'charlie' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    const { ws: spectWs } = await connect(port);

    send(hostWs, { type: 'hard-reset' });
    await nextMsg(spectWs, (m) => m.type === 'machine-reset');
    events.push('machine-reset-received');

    const doneIdx = events.indexOf('onCommand-done');
    const resetIdx = events.indexOf('machine-reset-received');
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(resetIdx).toBeGreaterThan(doneIdx);

    hostWs.close();
    spectWs.close();
  });

  it('broadcasts machine-rebooted only after the onCommand Promise resolves for reboot', async () => {
    const port = nextPort();
    const DELAY_MS = 60;
    const events: string[] = [];

    const srv = createInputServer({
      port,
      onInput: () => {},
      onCommand: (_cmd: any) =>
        new Promise<void>((res) => {
          events.push('onCommand-start');
          setTimeout(() => {
            events.push('onCommand-done');
            res();
          }, DELAY_MS);
        }),
    });
    servers.push(srv);

    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'charlie' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    const { ws: spectWs } = await connect(port);

    send(hostWs, { type: 'reboot' });
    await nextMsg(spectWs, (m) => m.type === 'machine-rebooted');
    events.push('machine-rebooted-received');

    const doneIdx = events.indexOf('onCommand-done');
    const rebootedIdx = events.indexOf('machine-rebooted-received');
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(rebootedIdx).toBeGreaterThan(doneIdx);

    hostWs.close();
    spectWs.close();
  });

  // ── cart-load-error broadcast when onCommand rejects ─────────────────────

  it('broadcasts cart-load-error when the onCommand Promise rejects', async () => {
    const port = nextPort();

    const srv = createInputServer({
      port,
      onInput: () => {},
      onCommand: (_cmd: any) => Promise.reject(new Error('disk-full')),
    });
    servers.push(srv);

    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'dave' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    const cartData = Buffer.from([1]).toString('base64');
    send(hostWs, { type: 'load-crt', filename: 'bad.crt', data: cartData });

    const err = await nextMsg(hostWs, (m) => m.type === 'cart-load-error');
    expect(err.reason).toContain('disk-full');

    hostWs.close();
  });

  // ── Non-host cannot send emulator commands ────────────────────────────────

  it('ignores load-crt from a non-host client', async () => {
    const port = nextPort();
    const called: string[] = [];

    const srv = createInputServer({
      port,
      onInput: () => {},
      onCommand: (cmd: any) => {
        called.push(cmd.type);
        return Promise.resolve();
      },
    });
    servers.push(srv);

    // Host claims the slot.
    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'eve' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    // Spectator tries to load a cart without being host.
    const { ws: spectWs } = await connect(port);
    const cartData = Buffer.from([9, 8]).toString('base64');
    send(spectWs, { type: 'load-crt', filename: 'hack.crt', data: cartData });

    // Give it some time to process.
    await new Promise((r) => setTimeout(r, 100));

    expect(called).toHaveLength(0);

    hostWs.close();
    spectWs.close();
  });

  // ── cart-loading broadcast fires before onCommand work begins ─────────────

  it('broadcasts cart-loading to all clients immediately when load-crt is received', async () => {
    const port = nextPort();

    const srv = createInputServer({
      port,
      onInput: () => {},
      onCommand: (_cmd: any) =>
        new Promise<void>((res) => {
          setTimeout(res, 80);
        }),
    });
    servers.push(srv);

    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'frank' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    const { ws: spectWs } = await connect(port);

    // Collect messages from spectator; cart-loading should arrive quickly.
    const collectPromise = collectMsgs(spectWs, 200);
    const cartData = Buffer.from([1, 2]).toString('base64');
    send(hostWs, { type: 'load-crt', filename: 'fast.crt', data: cartData });
    const msgs = await collectPromise;

    const types = msgs.map((m: any) => m.type);
    expect(types).toContain('cart-loading');
    expect(types).toContain('cart-loaded');

    hostWs.close();
    spectWs.close();
  });

  // ── P2 slot and host flow ─────────────────────────────────────────────────

  it('allows a second client to open-join as P2 when host is present', async () => {
    const port = nextPort();

    const srv = createInputServer({ port, onInput: () => {} });
    servers.push(srv);

    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'grace' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    const { ws: p2Ws } = await connect(port);
    send(p2Ws, { type: 'join-p2-open', username: 'heidi' });
    const confirmed = await nextMsg(p2Ws, (m) => m.type === 'join-p2-confirmed');
    expect(confirmed.username).toBe('heidi');
    expect(confirmed.joystickPort).toBeDefined();

    hostWs.close();
    p2Ws.close();
  });

  it('reserves P2 slot during reconnect grace and allows same username to reclaim it', async () => {
    const port = nextPort();

    const srv = createInputServer({
      port,
      onInput: () => {},
      p2ReconnectGraceMs: 300,
    });
    servers.push(srv);

    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'grace' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    const { ws: p2Ws } = await connect(port);
    send(p2Ws, { type: 'join-p2-open', username: 'heidi' });
    await nextMsg(p2Ws, (m) => m.type === 'join-p2-confirmed');

    p2Ws.close();

    const { ws: takeoverWs } = await connect(port);
    send(takeoverWs, { type: 'join-p2-open', username: 'mallory' });
    const blocked = await nextMsg(takeoverWs, (m) => m.type === 'join-p2-error');
    expect(blocked.reason).toBe('slot-taken');

    const { ws: p2RejoinWs } = await connect(port);
    send(p2RejoinWs, { type: 'join-p2-open', username: 'heidi' });
    const rejoined = await nextMsg(p2RejoinWs, (m) => m.type === 'join-p2-confirmed');
    expect(rejoined.username).toBe('heidi');

    hostWs.close();
    takeoverWs.close();
    p2RejoinWs.close();
  });

  it('re-opens P2 slot after reconnect grace expires without rejoin', async () => {
    const port = nextPort();

    const srv = createInputServer({
      port,
      onInput: () => {},
      p2ReconnectGraceMs: 120,
    });
    servers.push(srv);

    const { ws: hostWs } = await connect(port);
    send(hostWs, { type: 'host', username: 'grace' });
    await nextMsg(hostWs, (m) => m.type === 'host-confirmed');

    const { ws: p2Ws } = await connect(port);
    send(p2Ws, { type: 'join-p2-open', username: 'heidi' });
    await nextMsg(p2Ws, (m) => m.type === 'join-p2-confirmed');

    p2Ws.close();

    const { ws: blockedWs } = await connect(port);
    send(blockedWs, { type: 'join-p2-open', username: 'mallory' });
    const blocked = await nextMsg(blockedWs, (m) => m.type === 'join-p2-error');
    expect(blocked.reason).toBe('slot-taken');

    await new Promise((r) => setTimeout(r, 180));

    const { ws: afterGraceWs } = await connect(port);
    send(afterGraceWs, { type: 'join-p2-open', username: 'mallory' });
    const joinedAfterGrace = await nextMsg(afterGraceWs, (m) => m.type === 'join-p2-confirmed');
    expect(joinedAfterGrace.username).toBe('mallory');

    hostWs.close();
    blockedWs.close();
    afterGraceWs.close();
  });
});
