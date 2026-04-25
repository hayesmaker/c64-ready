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

    const keys = Array.from(document.querySelectorAll('.c64-help-controls .c64-help-key')).map((el) => el.textContent);
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
    ui.init(makePlayer({
      getActiveGamepadIndex: vi.fn(() => 2),
    }));

    const buttons = Array.from(document.querySelectorAll('.c64-gamepad-btn')) as HTMLButtonElement[];
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
    ui.init(makePlayer({
      getActiveGamepadIndex: vi.fn(() => 3),
    }));

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
});
