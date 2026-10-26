import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRIDGE_URL,
  bytesToBase64,
  getSavedUltimateSettings,
  getUltimateInfo,
  isUltimateFileType,
  isValidUltimateIp,
  launchOnUltimate,
  powerOffUltimate,
  rebootUltimate,
  saveUltimateSettings,
} from '../../src/player/ultimate-bridge';

const settings = { bridgeUrl: 'http://localhost:6464/', ip: '192.168.1.64', password: 'pw' };

function stubFetchJson(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

describe('ultimate-bridge', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('saves and restores bridge settings, defaulting the bridge URL', () => {
    expect(getSavedUltimateSettings()).toEqual({
      bridgeUrl: DEFAULT_BRIDGE_URL,
      ip: '',
      password: '',
    });

    saveUltimateSettings({ bridgeUrl: 'http://localhost:7000', ip: '10.0.0.5', password: 'x' });
    expect(getSavedUltimateSettings()).toEqual({
      bridgeUrl: 'http://localhost:7000',
      ip: '10.0.0.5',
      password: 'x',
    });

    saveUltimateSettings({ bridgeUrl: '', password: '' });
    expect(getSavedUltimateSettings()).toEqual({
      bridgeUrl: DEFAULT_BRIDGE_URL,
      ip: '10.0.0.5',
      password: '',
    });
  });

  it('validates IPv4 addresses and launchable file types', () => {
    expect(isValidUltimateIp(' 192.168.0.10 ')).toBe(true);
    expect(isValidUltimateIp('192.168.0.256')).toBe(false);
    expect(isValidUltimateIp('ultimate.local')).toBe(false);
    expect(isUltimateFileType('crt')).toBe(true);
    expect(isUltimateFileType('d64')).toBe(true);
    expect(isUltimateFileType('snapshot')).toBe(false);
  });

  it('base64-encodes bytes larger than one chunk', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i & 0xff);
    expect(atob(bytesToBase64(bytes)).length).toBe(bytes.length);
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 255]))).toBe('AAEC/w==');
  });

  it('posts info requests to the bridge and returns device info', async () => {
    const fetchMock = stubFetchJson({ product: 'Ultimate 64', firmware_version: '3.12' });

    const info = await getUltimateInfo(settings);

    expect(info.product).toBe('Ultimate 64');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:6464/ultimate/info');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(requestBody(fetchMock)).toEqual({ ip: '192.168.1.64', password: 'pw' });
  });

  it('sends launch payloads in the C64Cade bridge format', async () => {
    const fetchMock = stubFetchJson({ ok: true });

    await launchOnUltimate(settings, {
      fileType: 'crt',
      filename: 'game.crt',
      data: new Uint8Array([1, 2, 3]),
    });

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:6464/ultimate/launch');
    expect(requestBody(fetchMock)).toEqual({
      ip: '192.168.1.64',
      password: 'pw',
      fileType: 'crt',
      filename: 'game.crt',
      fileBase64: 'AQID',
      autoLoadCommand: 'LOAD"*",8,1\nRUN',
      joyPort: 2,
    });
  });

  it('posts reboot and power-off requests', async () => {
    const fetchMock = stubFetchJson({ ok: true });

    await rebootUltimate(settings);
    await powerOffUltimate(settings);

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:6464/ultimate/reboot');
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:6464/ultimate/poweroff');
    expect(requestBody(fetchMock, 1)).toMatchObject({ timeoutMs: 1500 });
  });

  it('surfaces errors reported by the bridge', async () => {
    stubFetchJson({ error: 'A valid Ultimate IPv4 address is required' }, false, 400);

    await expect(getUltimateInfo(settings)).rejects.toThrow(
      'A valid Ultimate IPv4 address is required',
    );
  });

  it('explains how to start the bridge when it is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(getUltimateInfo(settings)).rejects.toThrow(
      'Could not reach the Ultimate bridge at http://localhost:6464. Start it with: npx @c64cade/ultimate-bridge',
    );
  });
});
