import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorInput } from '../../src/emulator/input';
import { JOYSTICK_DIRECTION, JOYSTICK_FIRE_1, JOYSTICK_PORT_2 } from '../../src/emulator/constants';

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
});
