import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorInput } from '../../src/emulator/input';
import { JOYSTICK_DIRECTION, JOYSTICK_FIRE_1, JOYSTICK_PORT_2 } from '../../src/emulator/constants';
import { C64_KEY } from '../../src/emulator/c64-keys';

describe('EmulatorInput', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
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

  function dispatchGamepadEvent(type: 'gamepadconnected' | 'gamepaddisconnected', gamepad: Gamepad): void {
    const event = new Event(type);
    Object.defineProperty(event, 'gamepad', { value: gamepad });
    window.dispatchEvent(event);
  }

  it('maps cursor keys to joystick port 2', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;

    const input = new EmulatorInput(emulator, window);
    input.setInputMode('joystick');
    input.attach();

    const down = new KeyboardEvent('keydown', { code: 'ArrowLeft', cancelable: true });
    window.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(emulator.joystickPush).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_DIRECTION.LEFT);

    const up = new KeyboardEvent('keyup', { code: 'ArrowLeft', cancelable: true });
    window.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(emulator.joystickRelease).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_DIRECTION.LEFT);

    input.detach();
  });

  it('maps left control to fire1 and ignores held key repeats', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;

    const input = new EmulatorInput(emulator, window);
    input.setInputMode('joystick');
    input.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft', cancelable: true }));

    expect(emulator.joystickPush).toHaveBeenCalledTimes(1);
    expect(emulator.joystickPush).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_FIRE_1);

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ControlLeft', cancelable: true }));
    expect(emulator.joystickRelease).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_FIRE_1);

    input.detach();
  });

  it('allows keyboard joystick controls to be remapped', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;

    const input = new EmulatorInput(emulator, window);
    input.setInputMode('joystick');
    input.setKeyboardJoystickMap({
      KeyW: JOYSTICK_DIRECTION.UP,
      KeyF: JOYSTICK_FIRE_1,
    });
    input.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', cancelable: true }));
    expect(emulator.joystickPush).not.toHaveBeenCalled();

    const down = new KeyboardEvent('keydown', { code: 'KeyW', cancelable: true });
    window.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(emulator.joystickPush).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_DIRECTION.UP);

    const fireUp = new KeyboardEvent('keyup', { code: 'KeyF', cancelable: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', cancelable: true }));
    window.dispatchEvent(fireUp);
    expect(fireUp.defaultPrevented).toBe(true);
    expect(emulator.joystickRelease).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_FIRE_1);

    input.detach();
  });

  it('uses remapped joystick controls in mixed mode', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
      keyDown: vi.fn(),
      keyUp: vi.fn(),
    } as any;

    const input = new EmulatorInput(emulator, window);
    input.setInputMode('mixed');
    input.setKeyboardJoystickMap({ KeyI: JOYSTICK_DIRECTION.UP });
    input.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', cancelable: true }));
    expect(emulator.joystickPush).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_DIRECTION.UP);
    expect(emulator.keyDown).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp', cancelable: true }));
    expect(emulator.joystickPush).toHaveBeenCalledTimes(1);

    input.detach();
  });

  it('releases any held controls when detached', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;

    const input = new EmulatorInput(emulator, window);
    input.setInputMode('joystick');
    input.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft', cancelable: true }));

    input.detach();

    expect(emulator.joystickRelease).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_DIRECTION.UP);
    expect(emulator.joystickRelease).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_FIRE_1);
  });

  it('keeps the first connected gamepad active until changed explicitly', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;
    const firstPad = makeGamepad(1, 'First Pad');
    const secondPad = makeGamepad(2, 'Second Pad');
    vi.mocked(navigator.getGamepads).mockReturnValue([
      null,
      firstPad,
      secondPad,
    ] as unknown as Gamepad[]);

    const input = new EmulatorInput(emulator, window);
    input.attach();

    dispatchGamepadEvent('gamepadconnected', firstPad);
    dispatchGamepadEvent('gamepadconnected', secondPad);

    expect(input.getActiveGamepadIndex()).toBe(1);

    input.detach();
  });

  it('allows explicitly selecting another connected gamepad', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;
    const gamepads = [null, makeGamepad(1, 'First Pad'), makeGamepad(2, 'Second Pad')];
    vi.mocked(navigator.getGamepads).mockReturnValue(gamepads as unknown as Gamepad[]);

    const input = new EmulatorInput(emulator, window);
    input.attach();
    dispatchGamepadEvent('gamepadconnected', gamepads[1] as Gamepad);

    input.setActiveGamepadIndex(2);

    expect(input.getActiveGamepadIndex()).toBe(2);

    input.detach();
  });

  it('falls back to another connected gamepad when the active one disconnects', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;
    const firstPad = makeGamepad(1, 'First Pad');
    const secondPad = makeGamepad(2, 'Second Pad');
    vi.mocked(navigator.getGamepads)
      .mockReturnValueOnce([null, firstPad, secondPad] as unknown as Gamepad[])
      .mockReturnValue([null, null, secondPad] as unknown as Gamepad[]);

    const input = new EmulatorInput(emulator, window);
    input.attach();
    dispatchGamepadEvent('gamepadconnected', firstPad);
    input.setActiveGamepadIndex(1);

    dispatchGamepadEvent('gamepaddisconnected', firstPad);

    expect(input.getActiveGamepadIndex()).toBe(2);

    input.detach();
  });

  describe('gamepad mapping', () => {
    let buttons: number[];
    let axes: number[];
    let nextFrame: (() => void) | null;

    const gamepad = () =>
      ({
        ...makeGamepad(0),
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), value: 0 })),
        axes,
      }) as unknown as Gamepad;

    // Runs the next gamepad poll
    const poll = () => {
      const frame = nextFrame;
      nextFrame = null;
      frame?.();
    };

    const setup = () => {
      buttons = [];
      axes = [0, 0];
      nextFrame = null;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: () => void) => {
          nextFrame = cb;
          return 1;
        }),
      );
      vi.mocked(navigator.getGamepads).mockImplementation(() => [gamepad()] as unknown as Gamepad[]);
      const emulator = {
        joystickPush: vi.fn(),
        joystickRelease: vi.fn(),
        keyDown: vi.fn(),
        keyUp: vi.fn(),
      } as any;
      const input = new EmulatorInput(emulator, window);
      input.attach();
      dispatchGamepadEvent('gamepadconnected', gamepad());
      return { emulator, input };
    };

    it('keeps the default mapping: A fires, X is Space, Start is RUN/STOP', () => {
      const { emulator, input } = setup();
      buttons = [0, 2, 9];
      poll();
      expect(emulator.joystickPush).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_FIRE_1);
      expect(emulator.keyDown).toHaveBeenCalledWith(C64_KEY.SPACE);
      expect(emulator.keyDown).toHaveBeenCalledWith(C64_KEY.RUN_STOP);
      input.detach();
    });

    it('maps directions and buttons to C64 keys', () => {
      const { emulator, input } = setup();
      input.setGamepadMapping({
        stick: '2way',
        directions: { left: { key: C64_KEY.A }, right: { key: C64_KEY.S } },
        buttons: { a: { key: C64_KEY.RETURN }, b: { key: C64_KEY.SHIFT_LEFT } },
      });

      buttons = [14, 0, 1];
      poll();
      expect(emulator.keyDown).toHaveBeenCalledWith(C64_KEY.A);
      expect(emulator.keyDown).toHaveBeenCalledWith(C64_KEY.RETURN);
      expect(emulator.keyDown).toHaveBeenCalledWith(C64_KEY.SHIFT_LEFT);
      expect(emulator.joystickPush).not.toHaveBeenCalled();

      buttons = [];
      poll();
      expect(emulator.keyUp).toHaveBeenCalledWith(C64_KEY.A);
      expect(emulator.keyUp).toHaveBeenCalledWith(C64_KEY.RETURN);
      expect(emulator.keyUp).toHaveBeenCalledWith(C64_KEY.SHIFT_LEFT);
      input.detach();
    });

    it('ignores up and down in 2-way mode', () => {
      const { emulator, input } = setup();
      input.setGamepadMapping({ stick: '2way' });
      axes = [0, -1];
      poll();
      expect(emulator.joystickPush).not.toHaveBeenCalled();
      input.detach();
    });

    it('holds an input once while two controls map to it', () => {
      const { emulator, input } = setup();
      // B and D-pad up both map to joystick up by default
      buttons = [1, 12];
      poll();
      buttons = [12];
      poll();
      expect(emulator.joystickPush).toHaveBeenCalledTimes(1);
      expect(emulator.joystickRelease).not.toHaveBeenCalled();
      input.detach();
    });

    it('sends virtual gamepad controls through the same mapping', () => {
      const { emulator, input } = setup();
      input.setGamepadMapping({ buttons: { x: { key: C64_KEY.F1 } } });
      input.setVirtualGamepadState({ x: true, left: true });
      expect(emulator.keyDown).toHaveBeenCalledWith(C64_KEY.F1);
      expect(emulator.joystickPush).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_DIRECTION.LEFT);

      input.setVirtualGamepadState({});
      expect(emulator.keyUp).toHaveBeenCalledWith(C64_KEY.F1);
      expect(emulator.joystickRelease).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_DIRECTION.LEFT);
      input.detach();
    });

    it('releases what a control held when its mapping changes', () => {
      const { emulator, input } = setup();
      buttons = [0];
      poll();
      input.setGamepadMapping({ buttons: { a: { key: C64_KEY.RETURN } } });
      expect(emulator.joystickRelease).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_FIRE_1);
      expect(emulator.keyDown).toHaveBeenCalledWith(C64_KEY.RETURN);
      input.detach();
    });

    it('lets go of everything on detach', () => {
      const { emulator, input } = setup();
      buttons = [0];
      poll();
      input.setVirtualGamepadState({ x: true });
      input.detach();
      expect(emulator.joystickRelease).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_FIRE_1);
      expect(emulator.keyUp).toHaveBeenCalledWith(C64_KEY.SPACE);
    });
  });
});

