import { beforeEach, describe, expect, it, vi } from 'vitest';
import UIController from '../../src/player/ui-controller';

describe('UIController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.querySelectorAll('style[data-c64-help]').forEach((el) => el.remove());
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: vi.fn(() => []),
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-snapshot'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    window.localStorage.clear();
  });

  function makeGamepad(index: number, id = `Pad ${index}`): Gamepad {
    return {
      id,
      index,
      connected: true,
      mapping: 'standard',
      axes: [],
      buttons: [],
      timestamp: 0,
      hapticActuators: [],
      vibrationActuator: null,
    } as unknown as Gamepad;
  }

  function makePlayer(overrides: Record<string, unknown> = {}): any {
    return {
      setCrtPreloadChecksDisabled: vi.fn(),
      getActiveGamepadIndex: vi.fn(() => -1),
      setActiveGamepadIndex: vi.fn(),
      ramRead: vi.fn(() => 0xab),
      cpuRead: vi.fn(() => 0xfe),
      cpuWrite: vi.fn(),
      audio: {
        resume: vi.fn().mockResolvedValue(undefined),
        suspended: false,
        toggleMute: vi.fn(),
        setVolume: vi.fn(),
      },
      ...overrides,
    };
  }

  it('creates a help button and hidden overlay on init', () => {
    const ui = new UIController();
    ui.init();

    const btn = document.querySelector('.c64-help-btn') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('?');

    const overlay = document.querySelector('.c64-help-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('opens the dialog when the help button is clicked', () => {
    const ui = new UIController();
    ui.init();

    const btn = document.querySelector('.c64-help-btn') as HTMLButtonElement;
    btn.click();

    const overlay = document.querySelector('.c64-help-overlay') as HTMLElement;
    expect(overlay.classList.contains('visible')).toBe(true);
  });

  it('closes the dialog when the close button is clicked', () => {
    const ui = new UIController();
    ui.init();
    ui.open();

    const close = document.querySelector('.c64-help-close') as HTMLButtonElement;
    close.click();

    const overlay = document.querySelector('.c64-help-overlay') as HTMLElement;
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('closes the dialog when clicking the overlay backdrop', () => {
    const ui = new UIController();
    ui.init();
    ui.open();

    const overlay = document.querySelector('.c64-help-overlay') as HTMLElement;
    overlay.click();

    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('displays the key controls', () => {
    const ui = new UIController();
    ui.init();

    const items = document.querySelectorAll('.c64-help-controls li');
    expect(items.length).toBe(5);

    const keys = Array.from(document.querySelectorAll('.c64-help-controls .c64-help-key')).map(
      (el) => el.textContent,
    );
    expect(keys).toEqual(['↑', '↓', '←', '→', 'Z or Left Ctrl']);
  });

  it('contains a link to the GitHub repo', () => {
    const ui = new UIController();
    ui.init();

    const link = document.querySelector('.c64-help-dialog a') as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/hayesmaker/c64-ready');
    expect(link.target).toBe('_blank');
  });

  it('injects CSS style tag only once', () => {
    const ui1 = new UIController();
    ui1.init();
    const ui2 = new UIController();
    ui2.init();

    const styles = document.querySelectorAll('style[data-c64-help]');
    expect(styles.length).toBe(1);
  });

  it('renders one button per connected gamepad and highlights the active one', () => {
    vi.mocked(navigator.getGamepads).mockReturnValue([
      null,
      makeGamepad(1, '8bitdo Wireless Controller (standard gamepad)'),
      makeGamepad(2, 'USB Pad'),
    ] as unknown as Gamepad[]);

    const ui = new UIController();
    ui.init(
      makePlayer({
        getActiveGamepadIndex: vi.fn(() => 2),
      }),
    );

    const buttons = Array.from(
      document.querySelectorAll('.c64-gamepad-btn'),
    ) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.textContent)).toEqual([
      '1: 8bitdo Wireless Controller',
      '2: USB Pad',
    ]);
    expect(buttons[0].classList.contains('active')).toBe(false);
    expect(buttons[1].classList.contains('active')).toBe(true);
    expect((document.getElementById('c64-gamepad-empty') as HTMLElement).hidden).toBe(true);
  });

  it('switches the active gamepad when another gamepad button is pressed', () => {
    vi.mocked(navigator.getGamepads).mockReturnValue([
      null,
      makeGamepad(1, 'Arcade Stick'),
      makeGamepad(2, 'USB Pad'),
    ] as unknown as Gamepad[]);

    let activeIndex = 1;
    const player = {
      ...makePlayer(),
      getActiveGamepadIndex: vi.fn(() => activeIndex),
      setActiveGamepadIndex: vi.fn((index: number) => {
        activeIndex = index;
      }),
    };

    const ui = new UIController();
    ui.init(player as any);

    let buttons = Array.from(document.querySelectorAll('.c64-gamepad-btn')) as HTMLButtonElement[];
    buttons[1].click();
    buttons = Array.from(document.querySelectorAll('.c64-gamepad-btn')) as HTMLButtonElement[];

    expect(player.setActiveGamepadIndex).toHaveBeenCalledWith(2);
    expect(buttons[0].classList.contains('active')).toBe(false);
    expect(buttons[1].classList.contains('active')).toBe(true);
  });

  it('updates the gamepad list when controllers connect and disconnect', () => {
    const ui = new UIController();
    ui.init(
      makePlayer({
        getActiveGamepadIndex: vi.fn(() => 3),
      }),
    );

    window.dispatchEvent(
      new CustomEvent('c64-controller-connected', {
        detail: { index: 3, name: 'Bluetooth Pad' },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('c64-controller-connected', {
        detail: { index: 5, name: 'Arcade Stick' },
      }),
    );

    let buttons = Array.from(document.querySelectorAll('.c64-gamepad-btn')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].classList.contains('active')).toBe(true);

    window.dispatchEvent(
      new CustomEvent('c64-controller-disconnected', {
        detail: { index: 3 },
      }),
    );

    buttons = Array.from(document.querySelectorAll('.c64-gamepad-btn')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('5: Arcade Stick');
  });

  it('renders the always-visible cheats tab and persists edited cheat fields', () => {
    const ui = new UIController();
    ui.init(makePlayer());

    const cheatsTab = Array.from(document.querySelectorAll('[data-settings-tab]')).find(
      (tab) => tab.textContent === 'Cheats',
    ) as HTMLButtonElement;
    expect(cheatsTab).toBeTruthy();
    cheatsTab.click();

    const addressInput = document.querySelector('#c64-cheat-list input') as HTMLInputElement;
    addressInput.value = '$00c6';
    addressInput.dispatchEvent(new Event('input', { bubbles: true }));

    const stored = JSON.parse(window.localStorage.getItem('c64cade.cheatMode.v1') ?? '{}');
    expect(stored.cheats[0].address).toBe('$00c6');
  });

  it('records a cheat key and applies increment via global hotkey', () => {
    const player = makePlayer();
    const ui = new UIController();
    ui.init(player);

    (
      Array.from(document.querySelectorAll('[data-settings-tab]')).find(
        (tab) => tab.textContent === 'Cheats',
      ) as HTMLButtonElement
    ).click();

    (document.querySelector('[id^="c64-cheat-key-"]') as HTMLButtonElement).click();
    const keyButton = document.querySelector('[id^="c64-cheat-key-"]') as HTMLButtonElement;
    keyButton.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'F10', key: 'F10', bubbles: true, cancelable: true }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'F10', key: 'F10', bubbles: true, cancelable: true }),
    );

    expect(player.cpuRead).toHaveBeenCalledWith(0x004e);
    expect(player.cpuWrite).toHaveBeenCalledWith(0x004e, 0xff);
    expect(document.querySelector('#c64-cheat-status')?.textContent).toBe(
      'Increment 0x004e: 0xfe -> 0xff',
    );
  });

  it('applies a set cheat action from the menu', () => {
    window.localStorage.setItem(
      'c64cade.cheatMode.v1',
      JSON.stringify({
        cheats: [
          {
            id: 'cheat-1',
            address: '0x00c6',
            action: 'set',
            setValue: '$7f',
            keyBinding: { code: 'F9', key: 'F9', label: 'F9' },
          },
        ],
      }),
    );
    const player = makePlayer({ cpuRead: vi.fn(() => 0x02) });
    const ui = new UIController();
    ui.init(player);

    (
      Array.from(document.querySelectorAll('[data-settings-tab]')).find(
        (tab) => tab.textContent === 'Cheats',
      ) as HTMLButtonElement
    ).click();
    (
      Array.from(document.querySelectorAll('.c64-cheat-actions .c64-btn')).find(
        (button) => button.textContent === 'Apply Now',
      ) as HTMLButtonElement
    ).click();

    expect(player.cpuWrite).toHaveBeenCalledWith(0x00c6, 0x7f);
    expect(document.querySelector('#c64-cheat-status')?.textContent).toBe(
      'Set 0x00c6: 0x02 -> 0x7f',
    );
  });

  it('downloads a 64K RAM dump from the cheats tab', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const player = makePlayer({ ramRead: vi.fn((addr: number) => addr & 0xff) });
    const ui = new UIController();
    ui.init(player);

    (
      Array.from(document.querySelectorAll('[data-settings-tab]')).find(
        (tab) => tab.textContent === 'Cheats',
      ) as HTMLButtonElement
    ).click();
    (document.querySelector('#c64-dump-ram-btn') as HTMLButtonElement).click();

    expect(player.ramRead).toHaveBeenCalledTimes(0x10000);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(document.querySelector('#c64-cheat-status')?.textContent).toContain('Dumped 64K RAM');
  });

  it('downloads a snapshot from the system actions section', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const player = makePlayer({
      getSnapshot: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
    });

    const ui = new UIController();
    ui.init(player);

    const saveBtn = document.getElementById('c64-save-snapshot-btn') as HTMLButtonElement;
    saveBtn.click();

    expect(player.getSnapshot).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-snapshot');
  });

  it('loads the tools manifest relative to the configured asset base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ tools: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const ui = new UIController({ assetBaseUrl: '/c64-ready/' });
    ui.init(makePlayer());

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/c64-ready/tools/tools.json', { cache: 'no-store' });
    });
  });

  it('dispatches cheevos enable events with detector and pasted JSON', () => {
    const listener = vi.fn();
    window.addEventListener('c64-cheevos-enable', listener);

    try {
      const ui = new UIController();
      ui.init(makePlayer());

      const detector = document.getElementById('c64-cheevos-detector') as HTMLInputElement;
      const json = document.getElementById('c64-cheevos-json') as HTMLTextAreaElement;
      const enable = document.getElementById('c64-cheevos-enable-btn') as HTMLButtonElement;

      detector.value = 'uridium';
      json.value = '{"_id":"set1","cheevos":[]}';
      enable.click();

      expect(listener).toHaveBeenCalledOnce();
      expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({
        detectorId: 'uridium',
        jsonText: '{"_id":"set1","cheevos":[]}',
      });
    } finally {
      window.removeEventListener('c64-cheevos-enable', listener);
    }
  });

  it('loads cheevos JSON from a selected file before enabling', async () => {
    const listener = vi.fn();
    window.addEventListener('c64-cheevos-enable', listener);

    try {
      const ui = new UIController();
      ui.init(makePlayer());

      const detector = document.getElementById('c64-cheevos-detector') as HTMLInputElement;
      const json = document.getElementById('c64-cheevos-json') as HTMLTextAreaElement;
      const fileInput = document.getElementById('c64-cheevos-json-file') as HTMLInputElement;
      const browse = document.getElementById('c64-cheevos-browse-json-btn') as HTMLButtonElement;
      const filename = document.getElementById('c64-cheevos-json-filename') as HTMLElement;
      const enable = document.getElementById('c64-cheevos-enable-btn') as HTMLButtonElement;
      const jsonText = '{"_id":"uridium-dev-set","cheevos":[{"_id":"zinc","title":"Zinc"}]}';
      const file = new File([jsonText], 'uridium-cheevos.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', {
        configurable: true,
        value: vi.fn().mockResolvedValue(jsonText),
      });

      detector.value = 'uridium';
      const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
      browse.click();
      expect(clickSpy).toHaveBeenCalledOnce();
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [file],
      });
      fileInput.dispatchEvent(new Event('change'));

      await vi.waitFor(() => {
        expect(json.value).toBe(jsonText);
      });
      expect(filename.textContent).toBe('uridium-cheevos.json');

      enable.click();

      expect(listener).toHaveBeenCalledOnce();
      expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({
        detectorId: 'uridium',
        jsonText,
      });
    } finally {
      window.removeEventListener('c64-cheevos-enable', listener);
    }
  });

  it('updates the URL with a Vite /@fs cheevosSet path after selecting cheevos JSON', async () => {
    window.history.replaceState(null, '', '/c64-ready/');

    const ui = new UIController({ assetBaseUrl: '/c64-ready/' });
    ui.init(makePlayer());

    const detector = document.getElementById('c64-cheevos-detector') as HTMLInputElement;
    const json = document.getElementById('c64-cheevos-json') as HTMLTextAreaElement;
    const fileInput = document.getElementById('c64-cheevos-json-file') as HTMLInputElement;
    const jsonText = '{"_id":"uridium-dev-set","cheevos":[]}';
    const file = new File([jsonText], 'cheevos-set.json', { type: 'application/json' });
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: '/home/haymaker64/Homespace/c64-cheevos/docs/uridium/cheevos-set.json',
    });
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: vi.fn().mockResolvedValue(jsonText),
    });

    detector.value = 'uridium';
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() =>
      expect(window.location.search).toBe(
        '?cheevos=uridium&cheevosSet=%2F%40fs%2Fhome%2Fhaymaker64%2FHomespace%2Fc64-cheevos%2Fdocs%2Furidium%2Fcheevos-set.json',
      ),
    );
    expect(json.value).toBe(jsonText);
  });

  it('shows URL-loaded cheevos JSON in the editor textbox', () => {
    const ui = new UIController();
    ui.init(makePlayer());

    const json = document.getElementById('c64-cheevos-json') as HTMLTextAreaElement;
    const filename = document.getElementById('c64-cheevos-json-filename') as HTMLElement;
    const status = document.getElementById('c64-cheevos-status') as HTMLElement;
    const jsonText = '{"_id":"rainbow-islands","cheevos":[]}';

    window.dispatchEvent(
      new CustomEvent('c64-cheevos-json-loaded', {
        detail: { jsonText, source: '/c64-ready/@fs/rainbow-islands.json' },
      }),
    );

    expect(json.value).toBe(jsonText);
    expect(filename.textContent).toBe('/c64-ready/@fs/rainbow-islands.json');
    expect(status.textContent).toBe('Loaded JSON from /c64-ready/@fs/rainbow-islands.json');
  });

  it('enables cheevos ROM selection when a loaded set declares a romPath', async () => {
    const listener = vi.fn();
    window.addEventListener('c64-cheevos-rom-file', listener);

    try {
      const ui = new UIController();
      ui.init(makePlayer());

      const chooseRom = document.getElementById('c64-cheevos-choose-rom-btn') as HTMLButtonElement;
      const romFileInput = document.getElementById('c64-cheevos-rom-file') as HTMLInputElement;
      const cheevosStatus = document.getElementById('c64-cheevos-status') as HTMLElement;

      expect(chooseRom.disabled).toBe(true);
      window.dispatchEvent(
        new CustomEvent('c64-cheevos-rom-needed', {
          detail: { romPath: '~/C64/Uridium.d64', type: 'd64' },
        }),
      );
      expect(chooseRom.disabled).toBe(false);
      expect(cheevosStatus.textContent).toContain('~/C64/Uridium.d64');

      const clickSpy = vi.spyOn(romFileInput, 'click').mockImplementation(() => {});
      chooseRom.click();
      expect(clickSpy).toHaveBeenCalledOnce();

      const file = new File(['disk'], 'Uridium.d64', { type: 'application/octet-stream' });
      Object.defineProperty(romFileInput, 'files', {
        configurable: true,
        value: [file],
      });
      romFileInput.dispatchEvent(new Event('change'));

      await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
      expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({
        file,
        type: 'd64',
        romPath: '~/C64/Uridium.d64',
      });
    } finally {
      window.removeEventListener('c64-cheevos-rom-file', listener);
    }
  });

  it('dispatches cheevos tracker visibility changes from settings', () => {
    const listener = vi.fn();
    window.addEventListener('c64-cheevos-tracker-toggle', listener);

    try {
      const ui = new UIController();
      ui.init(makePlayer());

      const checkbox = document.getElementById('c64-cheevos-tracker-visible') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { visible: false } }),
      );
      expect(localStorage.getItem('c64-cheevos-tracker-visible')).toBe('0');
    } finally {
      window.removeEventListener('c64-cheevos-tracker-toggle', listener);
    }
  });
});
