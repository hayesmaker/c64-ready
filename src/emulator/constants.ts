export const JOYSTICK_PORT_1 = 1 as const;
export const JOYSTICK_PORT_2 = 2 as const;

/** 1-based joystick port number */
export type JoystickPort = typeof JOYSTICK_PORT_1 | typeof JOYSTICK_PORT_2;

export const JOYSTICK_DIRECTION = {
  UP: 0x1,
  DOWN: 0x2,
  LEFT: 0x4,
  RIGHT: 0x8,
} as const;

export const JOYSTICK_FIRE_1 = 0x10 as const;

/** Any valid joystick direction or fire bitmask */
export type JoystickInput =
  | typeof JOYSTICK_DIRECTION.UP
  | typeof JOYSTICK_DIRECTION.DOWN
  | typeof JOYSTICK_DIRECTION.LEFT
  | typeof JOYSTICK_DIRECTION.RIGHT
  | typeof JOYSTICK_FIRE_1;
