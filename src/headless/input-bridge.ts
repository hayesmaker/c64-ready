/**
 * Remote input bridge (WebSocket → emulator)
 * Allows remote players to control the emulator
 */

import type { InputEvent } from '../types';

export class InputBridge {
  onInput?: (event: InputEvent) => void;

  /**
   * Called when a remote input arrives (e.g., from WebSocket)
   */
  receiveRemoteInput(jsonString: string): void {
    try {
      const event: InputEvent = JSON.parse(jsonString);
      if (this.onInput) {
        this.onInput(event);
      }
    } catch (err) {
      // Keep minimal dependency on console in headless mode

      console.error('Failed to parse input:', err);
    }
  }

  /**
   * Example: encode a keypress for transmission
   */
  static encodeKeypress(key: string): string {
    return JSON.stringify({ type: 'key', key });
  }

  static encodeJoystick(port: 1 | 2, direction?: string, fire?: boolean): string {
    return JSON.stringify({
      type: 'joystick',
      joystickPort: port,
      direction,
      fire,
    });
  }
}
