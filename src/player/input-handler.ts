import { EmulatorInput } from '../emulator/input';
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
}
