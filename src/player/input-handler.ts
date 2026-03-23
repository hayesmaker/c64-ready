import { EmulatorInput } from '../emulator/input';
import type { JoystickPort } from '../emulator/constants';
import type { C64Emulator } from '../emulator/c64-emulator';

export default class InputHandler {
  private readonly emulatorInput: EmulatorInput;

  constructor(emulator: C64Emulator, target: EventTarget = window) {
    this.emulatorInput = new EmulatorInput(emulator, target);
  }

  attach(): void {
    this.emulatorInput.attach();
  }

  detach(): void {
    this.emulatorInput.detach();
  }

  /** Change which joystick port keyboard input maps to (1 or 2) */
  setKeyboardJoystickPort(port: JoystickPort): void {
    this.emulatorInput.setKeyboardPort(port);
  }
}
