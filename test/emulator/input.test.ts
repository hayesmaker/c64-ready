import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorInput } from '../../src/emulator/input';
import { JOYSTICK_DIRECTION, JOYSTICK_FIRE_1, JOYSTICK_PORT_2 } from '../../src/emulator/constants';

describe('EmulatorInput', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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
});
