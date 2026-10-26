import { beforeEach, describe, expect, it, vi } from 'vitest';
import UltimatePanel from '../../src/player/ultimate-panel';
import type { LoadedGame } from '../../src/player/c64-player';

function stubFetchJson(body: unknown = { product: 'Ultimate 64', firmware_version: '3.12' }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makePanel(game: LoadedGame | null = null) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const player = { getCurrentGame: vi.fn(() => game) } as any;
  new UltimatePanel(container, () => player).init();
  const el = <T extends HTMLElement>(id: string) => container.querySelector(`#${id}`) as T;
  return { container, player, el };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('UltimatePanel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('starts disconnected with launch and device controls disabled', () => {
    stubFetchJson();
    const { el } = makePanel();

    expect(el('c64-ultimate-device').textContent).toBe('Not connected');
    expect(el('c64-ultimate-current-game').textContent).toBe('No game loaded');
    expect(el<HTMLButtonElement>('c64-ultimate-send-current').disabled).toBe(true);
    expect(el<HTMLButtonElement>('c64-ultimate-send-file').disabled).toBe(true);
    expect(el<HTMLButtonElement>('c64-ultimate-reboot').disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for a valid IP before connecting', async () => {
    const fetchMock = stubFetchJson();
    const { el } = makePanel();

    el('c64-ultimate-connect').click();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el('c64-ultimate-status').textContent).toContain("Enter your Ultimate's IPv4 address");
    expect(el('c64-ultimate-status').dataset.mode).toBe('error');
  });

  it('connects, shows device info, and saves the IP', async () => {
    stubFetchJson({ product: 'Ultimate 64', firmware_version: '3.12', fpga_version: '11F' });
    const { el } = makePanel();
    const ip = el<HTMLInputElement>('c64-ultimate-ip');
    ip.value = '192.168.1.64';
    ip.dispatchEvent(new Event('change'));

    el('c64-ultimate-connect').click();
    await flush();

    expect(el('c64-ultimate-device').textContent).toBe(
      '● Ultimate 64 at 192.168.1.64 (firmware 3.12, FPGA 11F)',
    );
    expect(el('c64-ultimate-connect').textContent).toBe('Reconnect');
    expect(el<HTMLButtonElement>('c64-ultimate-send-file').disabled).toBe(false);
    expect(window.localStorage.getItem('c64-ultimate-ip')).toBe('192.168.1.64');
  });

  it('saves the IP to localStorage as it is typed and restores it on reload', () => {
    stubFetchJson();
    const { el } = makePanel();
    const ip = el<HTMLInputElement>('c64-ultimate-ip');

    ip.value = ' 10.0.0.42 ';
    ip.dispatchEvent(new Event('input'));
    expect(window.localStorage.getItem('c64-ultimate-ip')).toBe('10.0.0.42');

    document.body.innerHTML = '';
    const reloaded = makePanel();
    expect(reloaded.el<HTMLInputElement>('c64-ultimate-ip').value).toBe('10.0.0.42');
  });

  it('saves the IP when Connect is clicked without a change event', async () => {
    stubFetchJson();
    const { el } = makePanel();
    el<HTMLInputElement>('c64-ultimate-ip').value = '192.168.1.99';

    el('c64-ultimate-connect').click();
    await flush();

    expect(window.localStorage.getItem('c64-ultimate-ip')).toBe('192.168.1.99');
  });

  it('auto-connects on init when an IP is saved', async () => {
    window.localStorage.setItem('c64-ultimate-ip', '192.168.1.64');
    const fetchMock = stubFetchJson();
    const { el } = makePanel();
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(el('c64-ultimate-device').dataset.connected).toBe('true');
  });

  it('sends the current game to the Ultimate', async () => {
    window.localStorage.setItem('c64-ultimate-ip', '192.168.1.64');
    const fetchMock = stubFetchJson();
    const { el } = makePanel({ name: 'wilf.crt', type: 'crt', data: new Uint8Array([1, 2, 3]) });
    await flush();

    expect(el('c64-ultimate-current-game').textContent).toBe('wilf.crt');
    el('c64-ultimate-send-current').click();
    await flush();

    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:6464/ultimate/launch');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      fileType: 'crt',
      filename: 'wilf.crt',
      fileBase64: 'AQID',
    });
    expect(el('c64-ultimate-status').textContent).toBe(
      'Launched wilf.crt on Ultimate 64 at 192.168.1.64',
    );
  });

  it('refuses to send formats the Ultimate cannot launch', async () => {
    window.localStorage.setItem('c64-ultimate-ip', '192.168.1.64');
    const fetchMock = stubFetchJson();
    const { el } = makePanel({ name: 'save.s64', type: 'snapshot', data: new Uint8Array(1) });
    await flush();

    el('c64-ultimate-send-current').click();
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(el('c64-ultimate-status').textContent).toContain("can't launch snapshot files");
  });

  it('refreshes the current game label when a game loads or is detached', () => {
    stubFetchJson();
    let game: LoadedGame | null = null;
    const { el, player } = makePanel();
    player.getCurrentGame.mockImplementation(() => game);

    game = { name: 'new.prg', type: 'prg', data: new Uint8Array(1) };
    window.dispatchEvent(new CustomEvent('c64-load-success'));
    expect(el('c64-ultimate-current-game').textContent).toBe('new.prg');

    game = null;
    window.dispatchEvent(new CustomEvent('c64-detach'));
    expect(el('c64-ultimate-current-game').textContent).toBe('No game loaded');
  });

  it('only reboots after confirmation', async () => {
    window.localStorage.setItem('c64-ultimate-ip', '192.168.1.64');
    const fetchMock = stubFetchJson();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const { el } = makePanel();
    await flush();

    el('c64-ultimate-reboot').click();
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();

    confirmSpy.mockReturnValueOnce(true);
    el('c64-ultimate-reboot').click();
    await flush();
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:6464/ultimate/reboot');
    expect(el('c64-ultimate-status').textContent).toBe('Ultimate rebooted');
  });
});
