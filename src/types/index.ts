/**
 * Shared types and interfaces for C64 emulator
 */

export interface C64State {
  running: boolean;
  paused: boolean;
  frameCount: number;
  cycleCount: number;
}

export interface FrameBuffer {
  width: number;
  height: number;
  data: Uint8Array; // RGBA pixels
  timestamp: number;
}

export interface AudioBuffer {
  sampleRate: number;
  channels: number;
  samples: Float32Array;
  timestamp: number;
}

export interface InputEvent {
  type: 'key' | 'joystick';

  /** For 'key' events: the C64 key code (numeric or string) */
  key?: string | number;

  /** 'push'/'release' for joystick, 'down'/'up' for keyboard. Required for proper release handling. */
  action?: 'push' | 'release' | 'down' | 'up';

  /** 1-based joystick port (1 or 2). Default: 2. */
  joystickPort?: 1 | 2;

  /** Joystick direction name */
  direction?: 'up' | 'down' | 'left' | 'right';

  /** Unified fire button */
  fire?: boolean;

  /** @deprecated Use `fire` instead */
  fire1?: boolean;
  /** @deprecated Use `fire` instead */
  fire2?: boolean;
}

export interface GameLoadOptions {
  type: 'prg' | 'd64' | 'crt' | 'snapshot';
  data: Uint8Array;
  autoRun?: boolean;
}

export interface C64Config {
  videoWidth: number;
  videoHeight: number;
  sampleRate: number;
  audioChannels: number;
  cyclesPerFrame: number; // ~50 FPS PAL
}
