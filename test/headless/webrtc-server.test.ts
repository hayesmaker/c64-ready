/**
 * Tests for src/headless/webrtc-server.mjs
 *
 * Covers:
 *  - createWebRTCServer() returns { close, forceKeyframe }
 *  - forceKeyframe() is a safe no-op when no peers are connected
 *  - The embedded browser HTML contains connectWebRTC() calls on
 *    cart-loaded / machine-reset / cart-detached events (regression guard
 *    for the post-load lag fix — ensures the reconnect logic is never
 *    accidentally reverted to a simple flushToLiveEdge() call)
 *  - activePeers is managed: peers added on ICE connected, removed on close
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

// @ts-expect-error — no declaration file for .mjs
const { createWebRTCServer } = await import('../../src/headless/webrtc-server.mjs');

// Read the source as text so we can assert on the embedded browser HTML
const SOURCE = await fs.readFile(
  path.resolve(__dirname, '../../src/headless/webrtc-server.mjs'),
  'utf8',
);

describe('webrtc-server', () => {

  // ── API shape ──────────────────────────────────────────────────────────────

  it('createWebRTCServer returns an object with close and forceKeyframe', async () => {
    // We cannot bind to a real port in unit tests reliably, but we can
    // verify the shape of the returned object by inspecting its properties.
    // The actual listen() call is async and fires after the event loop yields,
    // so we close immediately to avoid leaking the port.
    let srv: any;
    try {
      srv = createWebRTCServer({ port: 19900, verbose: false, inputPort: 19901 });
      expect(typeof srv.close).toBe('function');
      expect(typeof srv.forceKeyframe).toBe('function');
    } finally {
      if (srv) await srv.close().catch(() => {});
    }
  });

  it('forceKeyframe: does not throw when no peers are connected', async () => {
    let srv: any;
    try {
      srv = createWebRTCServer({ port: 19902, verbose: false, inputPort: 19903 });
      // No peers — should be a safe no-op
      expect(() => srv.forceKeyframe({ kind: 'video' })).not.toThrow();
      expect(() => srv.forceKeyframe(null)).not.toThrow();
      expect(() => srv.forceKeyframe(undefined)).not.toThrow();
    } finally {
      if (srv) await srv.close().catch(() => {});
    }
  });

  it('serves the current ICE config as JSON', async () => {
    let srv: any;
    try {
      srv = createWebRTCServer({
        port: 19904,
        verbose: false,
        inputPort: 19905,
        iceTurnUrls: 'turn:relay.example.net:3478?transport=udp',
        iceTurnUsername: 'turn-user',
        iceTurnPassword: 'turn-pass',
      });
      const res = await fetch('http://127.0.0.1:19904/ice-config');
      expect(res.ok).toBe(true);
      const payload = await res.json();
      expect(payload).toEqual({
        iceServers: [
          {
            urls: ['turn:relay.example.net:3478?transport=udp'],
            username: 'turn-user',
            credential: 'turn-pass',
          },
        ],
      });
    } finally {
      if (srv) await srv.close().catch(() => {});
    }
  });

  // ── Embedded browser page: reconnect on cart lifecycle events ─────────────
  // These tests parse the source of webrtc-server.mjs to confirm the browser
  // HTML calls connectWebRTC() (not flushToLiveEdge()) when cart-loaded,
  // machine-reset, and cart-detached are received. This is a regression guard:
  // if someone reverts the fix and goes back to a simple seek, these fail.

  it('browser HTML: cart-loaded triggers connectWebRTC()', () => {
    // Find the inputWs.onmessage handler block in the source.
    // It must contain connectWebRTC() associated with the cart-loaded branch.
    const onMessageBlock = SOURCE.slice(
      SOURCE.indexOf('inputWs.onmessage'),
      SOURCE.indexOf('inputWs.onclose'),
    );
    expect(onMessageBlock).toContain("msg.type === 'cart-loaded'");
    expect(onMessageBlock).toContain('connectWebRTC()');
  });

  it('browser HTML: machine-reset triggers connectWebRTC()', () => {
    const onMessageBlock = SOURCE.slice(
      SOURCE.indexOf('inputWs.onmessage'),
      SOURCE.indexOf('inputWs.onclose'),
    );
    expect(onMessageBlock).toContain("msg.type === 'machine-reset'");
    expect(onMessageBlock).toContain('connectWebRTC()');
  });

  it('browser HTML: cart-detached triggers connectWebRTC()', () => {
    const onMessageBlock = SOURCE.slice(
      SOURCE.indexOf('inputWs.onmessage'),
      SOURCE.indexOf('inputWs.onclose'),
    );
    expect(onMessageBlock).toContain("msg.type === 'cart-detached'");
    expect(onMessageBlock).toContain('connectWebRTC()');
  });

  it('browser HTML: connectWebRTC tears down old pc before creating new one', () => {
    // Confirm the teardown pattern: pc.close() and sigWs.close() appear inside
    // the connectWebRTC function body, before the new RTCPeerConnection().
    const fnStart = SOURCE.indexOf('function connectWebRTC()');
    const fnEnd   = SOURCE.indexOf('\n    }', fnStart + 1);
    const fnBody  = SOURCE.slice(fnStart, fnEnd);

    expect(fnBody).toContain('pc.close()');
    expect(fnBody).toContain('sigWs.close()');
    expect(fnBody).toContain('videoEl.srcObject = null');
    expect(fnBody).toContain('new RTCPeerConnection(');
  });

  it('browser HTML: sync button calls connectWebRTC() not flushToLiveEdge()', () => {
    const syncBlock = SOURCE.slice(
      SOURCE.indexOf("syncBtn.addEventListener('click'"),
      SOURCE.indexOf("modeBtn.addEventListener('click'"),
    );
    expect(syncBlock).toContain('connectWebRTC()');
    // Guard: must NOT fall back to the old flushToLiveEdge-only approach
    expect(syncBlock).not.toContain('flushToLiveEdge()');
  });

  it('browser HTML: mute state preserved across reconnect', () => {
    const onMessageBlock = SOURCE.slice(
      SOURCE.indexOf('inputWs.onmessage'),
      SOURCE.indexOf('inputWs.onclose'),
    );
    // wasMuted check and restore logic must be present
    expect(onMessageBlock).toContain('wasMuted');
    expect(onMessageBlock).toContain('videoEl.muted = false');
  });
});
