import { EmulatorInput, JOYSTICK_KEY_CODES, MIXED_JOYSTICK_KEYS } from '../emulator/input';
import type { InputMode } from '../emulator/input';
import type { JoystickPort } from '../emulator/constants';
import type { C64Emulator } from '../emulator/c64-emulator';

export default class InputHandler {
  private readonly emulatorInput: EmulatorInput;
  // capture-phase blockers
  private readonly captureKeyDown = (e: KeyboardEvent) => this.onCaptureKeyDown(e);
  private readonly captureKeyUp = (e: KeyboardEvent) => this.onCaptureKeyUp(e);

  constructor(emulator: C64Emulator, target: EventTarget = window) {
    this.emulatorInput = new EmulatorInput(emulator, target);
  }

  attach(): void {
    // Install capture-phase listeners to block input when UI is open or tab unfocused
    window.addEventListener('keydown', this.captureKeyDown, true);
    window.addEventListener('keyup', this.captureKeyUp, true);
    this.emulatorInput.attach();
  }

  detach(): void {
    window.removeEventListener('keydown', this.captureKeyDown, true);
    window.removeEventListener('keyup', this.captureKeyUp, true);
    this.emulatorInput.detach();
  }

  /** Change which joystick port keyboard input maps to (1 or 2) */
  setKeyboardJoystickPort(port: JoystickPort): void {
    this.emulatorInput.setKeyboardPort(port);
  }

  /** Change the input mode ('joystick' | 'keyboard' | 'mixed') */
  setInputMode(mode: InputMode): void {
    this.emulatorInput.setInputMode(mode);
  }

  getInputMode(): InputMode {
    return this.emulatorInput.getInputMode();
  }

  private onCaptureKeyDown(e: KeyboardEvent): void {
    // Block joystick-mapped keys (standard + mixed mode) when overlays are
    // visible or the document is unfocused. Use the union of both key sets.
    const JOY_KEYS = new Set([
      ...(JOYSTICK_KEY_CODES as string[]),
      ...Object.keys(MIXED_JOYSTICK_KEYS),
    ]);
    if (!JOY_KEYS.has(e.code)) return;

    // Block if document is unfocused. Prefer the Visibility API (document.hidden)
    // which is stable under JSDOM; fall back to hasFocus() only if hidden is unavailable.
    // NOTE: We cast `document` to `Document` when checking `hasFocus` so TypeScript
    // understands the property exists at runtime. In some test environments (JSDOM)
    // the DOM typing may be looser or mocked; the cast keeps the code typed while
    // still allowing tests to override `document.hidden` or provide a `hasFocus`
    // implementation. We still prefer `document.hidden` when present.
    try {
      if (typeof document !== 'undefined') {
        if ('hidden' in document) {
          if ((document as Document & { hidden: boolean }).hidden) {
            e.stopImmediatePropagation();
            return;
          }
        } else if (
          typeof (document as Document).hasFocus === 'function' &&
          !(document as Document).hasFocus()
        ) {
          e.stopImmediatePropagation();
          return;
        }
      }
    } catch {
      // ignore DOM errors
    }

    // Block if UI overlays are visible
    try {
      if (typeof document !== 'undefined') {
        if (
          document.querySelector('.c64-help-overlay.visible') ||
          document.querySelector('.c64-menu-overlay.visible')
        ) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
      }
    } catch {
      // ignore DOM errors
    }
  }

  private onCaptureKeyUp(e: KeyboardEvent): void {
    // Only block joystick-mapped keys (standard + mixed mode)
    const JOY_KEYS = new Set([
      ...(JOYSTICK_KEY_CODES as string[]),
      ...Object.keys(MIXED_JOYSTICK_KEYS),
    ]);
    if (!JOY_KEYS.has(e.code)) return;

    // Mirror the same blocking logic for keyup events
    try {
      if (typeof document !== 'undefined') {
        if ('hidden' in document) {
          if ((document as Document & { hidden: boolean }).hidden) {
            e.stopImmediatePropagation();
            return;
          }
        } else if (
          typeof (document as Document).hasFocus === 'function' &&
          !(document as Document).hasFocus()
        ) {
          e.stopImmediatePropagation();
          return;
        }

        if (
          document.querySelector('.c64-help-overlay.visible') ||
          document.querySelector('.c64-menu-overlay.visible')
        ) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
      }
    } catch {
      // ignore DOM errors
    }
  }
}
