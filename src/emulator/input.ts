import type { C64Emulator } from './c64-emulator';
import { JOYSTICK_DIRECTION, JOYSTICK_FIRE_1, JOYSTICK_PORT_2 } from './constants';

const KEY_TO_JOYSTICK = {
  ArrowUp: JOYSTICK_DIRECTION.UP,
  ArrowDown: JOYSTICK_DIRECTION.DOWN,
  ArrowLeft: JOYSTICK_DIRECTION.LEFT,
  ArrowRight: JOYSTICK_DIRECTION.RIGHT,
  ControlLeft: JOYSTICK_FIRE_1,
} as const;

type MappedControl = keyof typeof KEY_TO_JOYSTICK;

export class EmulatorInput {
  private readonly emulator: C64Emulator;
  private readonly target: EventTarget;
  private readonly pressedControls = new Set<MappedControl>();
  private readonly keyDownHandler = (event: KeyboardEvent): void => {
    this.handleKeyDown(event);
  };
  private readonly keyUpHandler = (event: KeyboardEvent): void => {
    this.handleKeyUp(event);
  };

  constructor(emulator: C64Emulator, target: EventTarget = window) {
    this.emulator = emulator;
    this.target = target;
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
    const control = this.getMappedControl(event);
    if (!control || this.pressedControls.has(control)) {
      return;
    }

    this.pressedControls.add(control);
    this.emulator.joystickPush(JOYSTICK_PORT_2, KEY_TO_JOYSTICK[control]);
    event.preventDefault();
  }

  private handleKeyUp(event: KeyboardEvent): void {
    const control = this.getMappedControl(event);
    if (!control) {
      return;
    }

    this.pressedControls.delete(control);
    this.emulator.joystickRelease(JOYSTICK_PORT_2, KEY_TO_JOYSTICK[control]);
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
      this.emulator.joystickRelease(JOYSTICK_PORT_2, KEY_TO_JOYSTICK[control]);
    }
    this.pressedControls.clear();
  }
}
