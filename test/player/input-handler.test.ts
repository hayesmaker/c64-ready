import { beforeEach, describe, expect, it, vi } from 'vitest';
import InputHandler from '../../src/player/input-handler';
import { JOYSTICK_DIRECTION, JOYSTICK_PORT_2 } from '../../src/emulator/constants';

describe('InputHandler (capture blocking)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Clean DOM overlays between tests
    document.body.querySelectorAll('.c64-help-overlay, .c64-menu-overlay').forEach((el) => el.remove());
  });

  it('blocks joystick keydown when help overlay is visible', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;

    const input = new InputHandler(emulator, window as any);
    input.attach();

    // Show overlay that should block input
    const overlay = document.createElement('div');
    overlay.className = 'c64-help-overlay visible';
    document.body.appendChild(overlay);

    const ev = new KeyboardEvent('keydown', { code: 'ArrowLeft', cancelable: true });
    window.dispatchEvent(ev);

    // Emulator should not receive the event (capture handler blocked it)
    expect(emulator.joystickPush).not.toHaveBeenCalled();

    // Remove overlay and ensure input now passes through
    overlay.remove();
    const ev2 = new KeyboardEvent('keydown', { code: 'ArrowLeft', cancelable: true });
    window.dispatchEvent(ev2);
    expect(emulator.joystickPush).toHaveBeenCalledWith(JOYSTICK_PORT_2, JOYSTICK_DIRECTION.LEFT);

    input.detach();
  });

  it('blocks joystick key events when document is unfocused', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;

    const input = new InputHandler(emulator, window as any);
    input.attach();

    // Simulate unfocused tab via document.hidden (preferred in our logic)
    const origHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, writable: true, value: true });

    const ev = new KeyboardEvent('keydown', { code: 'ArrowUp', cancelable: true });
    window.dispatchEvent(ev);

    // Should not reach emulator; capture handler stops propagation
    expect(emulator.joystickPush).not.toHaveBeenCalled();

    // Restore original descriptor
    if (origHidden) Object.defineProperty(Document.prototype, 'hidden', origHidden);
    input.detach();
  });

  it('does not block non-joystick keys', () => {
    const emulator = {
      joystickPush: vi.fn(),
      joystickRelease: vi.fn(),
    } as any;

    const input = new InputHandler(emulator, window as any);
    input.attach();

    const ev = new KeyboardEvent('keydown', { code: 'KeyA', cancelable: true });
    window.dispatchEvent(ev);

    // Non-joystick key should not be blocked by capture handler
    expect(ev.defaultPrevented).toBe(false);
    expect(emulator.joystickPush).not.toHaveBeenCalled();

    input.detach();
  });
});

