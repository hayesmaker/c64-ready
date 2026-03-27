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
   * Encode a keypress for transmission
   */
  static encodeKeypress(key: string | number, action: 'down' | 'up' = 'down'): string {
    return JSON.stringify({ type: 'key', key, action });
  }

  /**
   * Encode a joystick event for transmission
   */
  static encodeJoystick(
    port: 1 | 2,
    action: 'push' | 'release',
    direction?: string,
    fire?: boolean,
  ): string {
    return JSON.stringify({
      type: 'joystick',
      joystickPort: port,
      action,
      direction,
      fire,
    });
  }
}
