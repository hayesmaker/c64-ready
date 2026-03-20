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
  key?: string;
  joystickPort?: 1 | 2;
  direction?: 'up' | 'down' | 'left' | 'right';
  fire1?: boolean;
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