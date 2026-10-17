import { C64_KEY } from './c64-keys';
import { JOYSTICK_DIRECTION, JOYSTICK_FIRE_1, type JoystickInput } from './constants';

/** Stick directions, from the D-pad, the left stick or a virtual (on-screen) stick */
export type GamepadDirection = 'up' | 'down' | 'left' | 'right';

/** Remappable buttons, named after the standard gamepad layout (Xbox style) */
export type GamepadButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt';

export type GamepadControl = GamepadDirection | GamepadButton;

/**
 * - '8way' — diagonals allowed (default)
 * - '4way' — one direction at a time; a diagonal keeps the direction already held
 * - '2way' — left and right only
 */
export type StickMode = '8way' | '4way' | '2way';

export type JoystickAction = 'up' | 'down' | 'left' | 'right' | 'fire';

/** What a control does: a joystick input, a C64 keyboard matrix key (see C64_KEY), or nothing (null) */
export type ControlAction = { joystick: JoystickAction } | { key: number } | null;

export interface GamepadMapping {
  stick?: StickMode;
  /** Unlisted directions keep their default action */
  directions?: Partial<Record<GamepadDirection, ControlAction>>;
  /** Unlisted buttons keep their default action */
  buttons?: Partial<Record<GamepadButton, ControlAction>>;
}

export type ResolvedGamepadMapping = {
  stick: StickMode;
  directions: Record<GamepadDirection, ControlAction>;
  buttons: Record<GamepadButton, ControlAction>;
};

/** Which controls are held. Missing controls count as released. */
export type GamepadState = Partial<Record<GamepadControl, boolean>>;

export const GAMEPAD_DIRECTIONS: GamepadDirection[] = ['up', 'down', 'left', 'right'];
export const GAMEPAD_BUTTONS: GamepadButton[] = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt'];

/** Standard mapping button indices (https://w3c.github.io/gamepad/#remapping) */
export const STANDARD_BUTTON_INDEX: Record<GamepadButton | 'start' | GamepadDirection, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
};

const STICK_THRESHOLD = 0.5;

/** The mapping c64-ready has always used: A fires, B is up, X is Space and RT is RUN/STOP */
export const DEFAULT_GAMEPAD_MAPPING: ResolvedGamepadMapping = Object.freeze({
  stick: '8way',
  directions: Object.freeze({
    up: { joystick: 'up' },
    down: { joystick: 'down' },
    left: { joystick: 'left' },
    right: { joystick: 'right' },
  }),
  buttons: Object.freeze({
    a: { joystick: 'fire' },
    b: { joystick: 'up' },
    x: { key: C64_KEY.SPACE },
    y: null,
    lb: null,
    rb: null,
    lt: null,
    rt: { key: C64_KEY.RUN_STOP },
  }),
}) as ResolvedGamepadMapping;

const STICK_MODES: StickMode[] = ['8way', '4way', '2way'];
const JOYSTICK_ACTIONS: JoystickAction[] = ['up', 'down', 'left', 'right', 'fire'];
const C64_KEY_CODES = new Set<number>(Object.values(C64_KEY));

function normaliseAction(action: unknown, fallback: ControlAction): ControlAction {
  if (action === undefined) return fallback;
  if (action === null) return null;
  if (typeof action !== 'object') return fallback;
  const { joystick, key } = action as { joystick?: unknown; key?: unknown };
  if (JOYSTICK_ACTIONS.includes(joystick as JoystickAction))
    return { joystick: joystick as JoystickAction };
  if (typeof key === 'number' && C64_KEY_CODES.has(key)) return { key };
  return fallback;
}

/** Fills in defaults and drops anything invalid, so the result can be used as is */
export function resolveGamepadMapping(mapping?: GamepadMapping | null): ResolvedGamepadMapping {
  const base = DEFAULT_GAMEPAD_MAPPING;
  const stick = STICK_MODES.includes(mapping?.stick as StickMode)
    ? (mapping!.stick as StickMode)
    : base.stick;
  const directions = {} as Record<GamepadDirection, ControlAction>;
  for (const direction of GAMEPAD_DIRECTIONS) {
    directions[direction] = normaliseAction(
      mapping?.directions?.[direction],
      base.directions[direction],
    );
  }
  const buttons = {} as Record<GamepadButton, ControlAction>;
  for (const button of GAMEPAD_BUTTONS) {
    buttons[button] = normaliseAction(mapping?.buttons?.[button], base.buttons[button]);
  }
  return { stick, directions, buttons };
}

/**
 * Reads a standard-mapping gamepad into named controls.
 * Directions come from the D-pad buttons, the left stick, or axes 6/7 (D-pads reported as axes, e.g. 8BitDo).
 */
export function readGamepadState(gamepad: Gamepad): GamepadState & { start: boolean } {
  const pressed = (index: number) => !!gamepad.buttons?.[index]?.pressed;
  const axis = (index: number) => gamepad.axes?.[index] ?? 0;
  const state: GamepadState & { start: boolean } = {
    up:
      pressed(STANDARD_BUTTON_INDEX.up) ||
      axis(1) <= -STICK_THRESHOLD ||
      axis(7) <= -STICK_THRESHOLD,
    down:
      pressed(STANDARD_BUTTON_INDEX.down) ||
      axis(1) >= STICK_THRESHOLD ||
      axis(7) >= STICK_THRESHOLD,
    left:
      pressed(STANDARD_BUTTON_INDEX.left) ||
      axis(0) <= -STICK_THRESHOLD ||
      axis(6) <= -STICK_THRESHOLD,
    right:
      pressed(STANDARD_BUTTON_INDEX.right) ||
      axis(0) >= STICK_THRESHOLD ||
      axis(6) >= STICK_THRESHOLD,
    start: pressed(STANDARD_BUTTON_INDEX.start),
  };
  for (const button of GAMEPAD_BUTTONS) state[button] = pressed(STANDARD_BUTTON_INDEX[button]);
  return state;
}

/**
 * Limits held directions to the stick mode.
 * In 4-way mode a diagonal keeps whichever axis was already held (`previous`), else it goes horizontal.
 */
export function restrictDirections(
  state: GamepadState,
  mode: StickMode,
  previous: GamepadState = {},
): Record<GamepadDirection, boolean> {
  let up = !!state.up && !state.down;
  let down = !!state.down && !state.up;
  let left = !!state.left && !state.right;
  let right = !!state.right && !state.left;

  if (mode === '2way') {
    up = false;
    down = false;
  } else if (mode === '4way' && (up || down) && (left || right)) {
    const keepVertical = (up && !!previous.up) || (down && !!previous.down);
    const keepHorizontal = (left && !!previous.left) || (right && !!previous.right);
    if (keepVertical && !keepHorizontal) {
      left = false;
      right = false;
    } else {
      up = false;
      down = false;
    }
  }

  return { up, down, left, right };
}

const JOYSTICK_BITS: Record<JoystickAction, JoystickInput> = {
  up: JOYSTICK_DIRECTION.UP,
  down: JOYSTICK_DIRECTION.DOWN,
  left: JOYSTICK_DIRECTION.LEFT,
  right: JOYSTICK_DIRECTION.RIGHT,
  fire: JOYSTICK_FIRE_1,
};

/** An emulator input to hold: a joystick bit on the active port, or a keyboard matrix key */
export type GamepadOutput = { joystick: JoystickInput } | { key: number };

/** Stable id for an output, so two controls mapped to the same thing hold it once */
export const outputId = (output: GamepadOutput): string =>
  'joystick' in output ? `j${output.joystick}` : `k${output.key}`;

/** The emulator inputs to hold for these (already direction-restricted) controls */
export function resolveOutputs(
  state: GamepadState,
  mapping: ResolvedGamepadMapping,
): Map<string, GamepadOutput> {
  const outputs = new Map<string, GamepadOutput>();
  const add = (action: ControlAction) => {
    if (!action) return;
    const output: GamepadOutput =
      'joystick' in action ? { joystick: JOYSTICK_BITS[action.joystick] } : { key: action.key };
    outputs.set(outputId(output), output);
  };
  for (const direction of GAMEPAD_DIRECTIONS)
    if (state[direction]) add(mapping.directions[direction]);
  for (const button of GAMEPAD_BUTTONS) if (state[button]) add(mapping.buttons[button]);
  return outputs;
}
