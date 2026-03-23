import type { C64Emulator } from './c64-emulator';
import { JOYSTICK_DIRECTION, JOYSTICK_FIRE_1, JOYSTICK_PORT_2 } from './constants';
import type { JoystickPort } from './constants';

export const KEY_TO_JOYSTICK = {
  ArrowUp: JOYSTICK_DIRECTION.UP,
  ArrowDown: JOYSTICK_DIRECTION.DOWN,
  ArrowLeft: JOYSTICK_DIRECTION.LEFT,
  ArrowRight: JOYSTICK_DIRECTION.RIGHT,
  ControlLeft: JOYSTICK_FIRE_1,
} as const;

/**
 * Array of keyboard codes that map to joystick inputs. Exported so
 * external UI/input handlers can derive their blocking behavior from
 * the same canonical mapping used by the emulator.
 */
export const JOYSTICK_KEY_CODES: Array<keyof typeof KEY_TO_JOYSTICK> = Object.keys(
  KEY_TO_JOYSTICK,
) as Array<keyof typeof KEY_TO_JOYSTICK>;

type MappedControl = keyof typeof KEY_TO_JOYSTICK;

export class EmulatorInput {
  private readonly emulator: C64Emulator;
  private readonly target: EventTarget;
  // Which joystick port keyboard events map to (1 or 2). Default is port 2.
  private keyboardJoystickPort: JoystickPort;
  private readonly pressedControls = new Set<MappedControl>();
  private readonly keyDownHandler = (event: KeyboardEvent): void => {
    this.handleKeyDown(event);
  };
  private readonly keyUpHandler = (event: KeyboardEvent): void => {
    this.handleKeyUp(event);
  };

  constructor(
    emulator: C64Emulator,
    target: EventTarget = window,
    defaultPort: JoystickPort = JOYSTICK_PORT_2,
  ) {
    this.emulator = emulator;
    this.target = target;
    this.keyboardJoystickPort = defaultPort;
  }

  attach(): void {
    this.target.addEventListener('keydown', this.keyDownHandler as EventListener);
    this.target.addEventListener('keyup', this.keyUpHandler as EventListener);
  }

  detach(): void {
    this.target.removeEventListener('keydown', this.keyDownHandler as EventListener);
    this.target.removeEventListener('keyup', this.keyUpHandler as EventListener);
    this.releaseAll();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // handle keydown
    const control = this.getMappedControl(event);
    if (!control || this.pressedControls.has(control)) {
      return;
    }

    this.pressedControls.add(control);
    this.emulator.joystickPush(this.keyboardJoystickPort, KEY_TO_JOYSTICK[control]);
    event.preventDefault();
  }

  private handleKeyUp(event: KeyboardEvent): void {
    // handle keyup
    const control = this.getMappedControl(event);
    if (!control) {
      return;
    }

    this.pressedControls.delete(control);
    this.emulator.joystickRelease(this.keyboardJoystickPort, KEY_TO_JOYSTICK[control]);
    event.preventDefault();
  }

  private getMappedControl(event: KeyboardEvent): MappedControl | null {
    if (event.code in KEY_TO_JOYSTICK) {
      return event.code as MappedControl;
    }

    return null;
  }

  private releaseAll(): void {
    for (const control of this.pressedControls) {
      this.emulator.joystickRelease(this.keyboardJoystickPort, KEY_TO_JOYSTICK[control]);
    }
    this.pressedControls.clear();
  }

  /** Set which joystick port keyboard controls should target (1 or 2). */
  setKeyboardPort(port: JoystickPort): void {
    // If port is unchanged, do nothing.
    if (this.keyboardJoystickPort === port) return;
    // Release any pressed controls on the old port before switching.
    this.releaseAll();
    this.keyboardJoystickPort = port;
  }
}
