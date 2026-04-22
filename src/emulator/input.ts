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

/**
 * Input modes:
 * - 'joystick'  — arrow keys + ControlLeft map to joystick only
 * - 'keyboard'  — all keys route to the C64 keyboard matrix; no joystick
 * - 'mixed'     — arrow keys + Z + ControlLeft drive the joystick AND all
 *                 other keys route to the C64 keyboard matrix
 */
export type InputMode = 'joystick' | 'keyboard' | 'mixed';

/**
 * Mixed-mode joystick key set: arrows + Z (fire alternative) + ControlLeft.
 * These keys are consumed as joystick inputs and NOT forwarded to the
 * C64 keyboard matrix in mixed mode.
 */
export const MIXED_JOYSTICK_KEYS: Record<string, number> = {
  ArrowUp: JOYSTICK_DIRECTION.UP,
  ArrowDown: JOYSTICK_DIRECTION.DOWN,
  ArrowLeft: JOYSTICK_DIRECTION.LEFT,
  ArrowRight: JOYSTICK_DIRECTION.RIGHT,
  KeyZ: JOYSTICK_FIRE_1,
  ControlLeft: JOYSTICK_FIRE_1,
};

// ---------------------------------------------------------------------------
// Browser keyboard → C64 matrix index mapping
// Mirrors src/headless/c64-key-map.mjs so the browser player can send
// typed characters to the C64 keyboard matrix.
// ---------------------------------------------------------------------------

/** C64 keyboard matrix indices */
export const C64_KEY = {
  ARROW_LEFT: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  ZERO: 10,
  PLUS: 11,
  MINUS: 12,
  POUND: 13,
  CLEAR_HOME: 14,
  INS_DEL: 15,
  CTRL: 16,
  Q: 17,
  W: 18,
  E: 19,
  R: 20,
  T: 21,
  Y: 22,
  U: 23,
  I: 24,
  O: 25,
  P: 26,
  AT: 27,
  STAR: 28,
  ARROW_UP: 29,
  RUN_STOP: 30,
  A: 31,
  S: 32,
  D: 33,
  F: 34,
  G: 35,
  H: 36,
  J: 37,
  K: 38,
  L: 39,
  COLON: 40,
  SEMICOLON: 41,
  EQUALS: 42,
  RETURN: 43,
  COMMODORE: 44,
  SHIFT_LEFT: 45,
  Z: 46,
  X: 47,
  C: 48,
  V: 49,
  B: 50,
  N: 51,
  M: 52,
  COMMA: 53,
  PERIOD: 54,
  SLASH: 55,
  SHIFT_RIGHT: 56,
  CURSOR_UP_DOWN: 57,
  CURSOR_LEFT_RIGHT: 58,
  SPACE: 59,
  F1: 60,
  F3: 61,
  F5: 62,
  F7: 63,
  RESTORE: 64,
} as const;

type C64KeyAction = { key: number; action: 'press' | 'release' };

/**
 * Translate a browser KeyboardEvent into a sequence of C64 matrix actions.
 * Returns an empty array for unmapped / ignored keys.
 */
export function domKeyToC64Actions(
  domKey: string,
  shiftKey: boolean,
  eventType: 'keydown' | 'keyup',
): C64KeyAction[] {
  const k = domKey.toLowerCase();
  const isDown = eventType === 'keydown';
  const actions: C64KeyAction[] = [];

  const press = (idx: number) => actions.push({ key: idx, action: 'press' });
  const release = (idx: number) => actions.push({ key: idx, action: 'release' });
  const main = (idx: number) => actions.push({ key: idx, action: isDown ? 'press' : 'release' });

  // Handle host shift state first for plain alpha/numeric keys
  if (isDown) {
    if (shiftKey) {
      press(C64_KEY.SHIFT_LEFT);
    } else {
      if (k !== 'arrowup' && k !== 'arrowleft') {
        release(C64_KEY.SHIFT_LEFT);
        release(C64_KEY.SHIFT_RIGHT);
      }
    }
  }

  switch (k) {
    // ── Letters ─────────────────────────────────────────────────────────────
    case 'a':
      main(C64_KEY.A);
      break;
    case 'b':
      main(C64_KEY.B);
      break;
    case 'c':
      main(C64_KEY.C);
      break;
    case 'd':
      main(C64_KEY.D);
      break;
    case 'e':
      main(C64_KEY.E);
      break;
    case 'f':
      main(C64_KEY.F);
      break;
    case 'g':
      main(C64_KEY.G);
      break;
    case 'h':
      main(C64_KEY.H);
      break;
    case 'i':
      main(C64_KEY.I);
      break;
    case 'j':
      main(C64_KEY.J);
      break;
    case 'k':
      main(C64_KEY.K);
      break;
    case 'l':
      main(C64_KEY.L);
      break;
    case 'm':
      main(C64_KEY.M);
      break;
    case 'n':
      main(C64_KEY.N);
      break;
    case 'o':
      main(C64_KEY.O);
      break;
    case 'p':
      main(C64_KEY.P);
      break;
    case 'q':
      main(C64_KEY.Q);
      break;
    case 'r':
      main(C64_KEY.R);
      break;
    case 's':
      main(C64_KEY.S);
      break;
    case 't':
      main(C64_KEY.T);
      break;
    case 'u':
      main(C64_KEY.U);
      break;
    case 'v':
      main(C64_KEY.V);
      break;
    case 'w':
      main(C64_KEY.W);
      break;
    case 'x':
      main(C64_KEY.X);
      break;
    case 'y':
      main(C64_KEY.Y);
      break;
    case 'z':
      main(C64_KEY.Z);
      break;

    // ── Numbers ──────────────────────────────────────────────────────────────
    case '0':
      main(C64_KEY.ZERO);
      break;
    case '1':
      main(C64_KEY.ONE);
      break;
    case '2':
      main(C64_KEY.TWO);
      break;
    case '3':
      main(C64_KEY.THREE);
      break;
    case '4':
      main(C64_KEY.FOUR);
      break;
    case '5':
      main(C64_KEY.FIVE);
      break;
    case '6':
      main(C64_KEY.SIX);
      break;
    case '7':
      main(C64_KEY.SEVEN);
      break;
    case '8':
      main(C64_KEY.EIGHT);
      break;
    case '9':
      main(C64_KEY.NINE);
      break;

    // ── Shifted number row ───────────────────────────────────────────────────
    case '!':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.ONE);
      break;
    case '"':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.TWO);
      break;
    case '#':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.THREE);
      break;
    case '$':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.FOUR);
      break;
    case '%':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.FIVE);
      break;
    case '&':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.SIX);
      break;
    case "'":
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.SEVEN);
      break;
    case '(':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.EIGHT);
      break;
    case ')':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.NINE);
      break;

    // ── Symbols ──────────────────────────────────────────────────────────────
    case ' ':
      main(C64_KEY.SPACE);
      break;
    case 'enter':
      main(C64_KEY.RETURN);
      break;
    case 'backspace':
    case 'delete':
      main(C64_KEY.INS_DEL);
      break;
    case 'escape':
      main(C64_KEY.RUN_STOP);
      break;
    case '-':
      main(C64_KEY.MINUS);
      break;
    case '=':
      main(C64_KEY.EQUALS);
      break;
    case '+':
      if (isDown) {
        release(C64_KEY.SHIFT_LEFT);
        release(C64_KEY.SHIFT_RIGHT);
      }
      main(C64_KEY.PLUS);
      break;
    case '*':
      if (isDown) {
        release(C64_KEY.SHIFT_LEFT);
        release(C64_KEY.SHIFT_RIGHT);
      }
      main(C64_KEY.STAR);
      break;
    case '@':
      if (isDown) {
        release(C64_KEY.SHIFT_LEFT);
        release(C64_KEY.SHIFT_RIGHT);
      }
      main(C64_KEY.AT);
      break;
    case '^':
      if (isDown) {
        release(C64_KEY.SHIFT_LEFT);
        release(C64_KEY.SHIFT_RIGHT);
      }
      main(C64_KEY.ARROW_UP);
      break;
    case '`':
      main(C64_KEY.ARROW_LEFT);
      break;
    case '~':
      main(C64_KEY.ARROW_UP);
      break;
    case '\\':
      main(C64_KEY.POUND);
      break;
    case ',':
    case '<':
      main(C64_KEY.COMMA);
      break;
    case '.':
    case '>':
      main(C64_KEY.PERIOD);
      break;
    case '/':
    case '?':
      main(C64_KEY.SLASH);
      break;
    case ';':
      main(C64_KEY.SEMICOLON);
      break;
    case ':':
      if (isDown) {
        release(C64_KEY.SHIFT_LEFT);
        release(C64_KEY.SHIFT_RIGHT);
      }
      main(C64_KEY.COLON);
      break;
    case '[':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.COLON);
      break;
    case ']':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.SEMICOLON);
      break;

    // ── Modifier / special keys ───────────────────────────────────────────────
    case 'shift':
      main(C64_KEY.SHIFT_LEFT);
      break;
    case 'tab':
      main(C64_KEY.CTRL);
      break;
    case 'control':
      main(C64_KEY.COMMODORE);
      break;
    case 'capslock':
      main(C64_KEY.COMMODORE);
      break;
    case 'home':
      main(C64_KEY.CLEAR_HOME);
      break;
    case 'pageup':
      main(C64_KEY.RESTORE);
      break;

    // ── Function keys ────────────────────────────────────────────────────────
    case 'f1':
      main(C64_KEY.F1);
      break;
    case 'f2':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.F1);
      break;
    case 'f3':
      main(C64_KEY.F3);
      break;
    case 'f4':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.F3);
      break;
    case 'f5':
      main(C64_KEY.F5);
      break;
    case 'f6':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.F5);
      break;
    case 'f7':
      main(C64_KEY.F7);
      break;
    case 'f8':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.F7);
      break;

    // ── Cursor keys ───────────────────────────────────────────────────────────
    // Down/Right are unshifted; Up/Left use Shift+cursor.
    case 'arrowdown':
      main(C64_KEY.CURSOR_UP_DOWN);
      break;
    case 'arrowup':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.CURSOR_UP_DOWN);
      break;
    case 'arrowright':
      main(C64_KEY.CURSOR_LEFT_RIGHT);
      break;
    case 'arrowleft':
      if (isDown) press(C64_KEY.SHIFT_LEFT);
      else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.CURSOR_LEFT_RIGHT);
      break;

    default:
      break;
  }

  return actions;
}

type MappedControl = keyof typeof KEY_TO_JOYSTICK;

export class EmulatorInput {
  private readonly emulator: C64Emulator;
  private readonly target: EventTarget;
  // Which joystick port keyboard events map to (1 or 2). Default is port 2.
  private keyboardJoystickPort: JoystickPort;
  private inputMode: InputMode = 'mixed';
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
    this.target.addEventListener("gamepadconnected", this.handleGamepadConnected as EventListener);
    this.target.addEventListener("gamepaddisconnected", this.handleGamepadDisconnected as EventListener);
    this.target.addEventListener('keydown', this.keyDownHandler as EventListener);
    this.target.addEventListener('keyup', this.keyUpHandler as EventListener);
  }

  detach(): void {
    this.target.removeEventListener("gamepadconnected", this.handleGamepadConnected as EventListener);
    this.target.removeEventListener('keydown', this.keyDownHandler as EventListener);
    this.target.removeEventListener('keyup', this.keyUpHandler as EventListener);
    this.releaseAll();
  }

  private handleGamepadDisconnected(event: GamepadEvent): void {
    console.log(
      "Gamepad disconnected from index %d: %s",
      event.gamepad.index,
      event.gamepad.id,
    );
    const gamepadDisconnected = new CustomEvent("c64-controller-disconnected", {
      detail: {
        name: event.gamepad.id,
        index: event.gamepad.index,
      }
    });
    window.dispatchEvent(gamepadDisconnected);

  }

  private handleGamepadConnected(event: GamepadEvent): void {
    console.log(
      "Gamepad connected at index %d: %s. %d buttons, %d axes.",
      event.gamepad.index,
      event.gamepad.id,
      event.gamepad.buttons.length,
      event.gamepad.axes.length,
    );
    const gamepadConnected = new CustomEvent("c64-controller-connected", {
      detail: {
        name: event.gamepad.id,
        index: event.gamepad.index,
      }
    });
    window.dispatchEvent(gamepadConnected);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.inputMode === 'keyboard') {
      // Pure keyboard mode — all keys go to C64 matrix, no joystick
      const acts = domKeyToC64Actions(event.key, event.shiftKey, 'keydown');
      if (acts.length > 0) {
        for (const act of acts) {
          if (act.action === 'press') this.emulator.keyDown(act.key);
          else this.emulator.keyUp(act.key);
        }
        event.preventDefault();
      }
      return;
    }

    if (this.inputMode === 'mixed') {
      // Mixed mode — joystick keys (arrows + Z + ControlLeft) drive joystick;
      // all other keys route to the C64 keyboard matrix.
      if (event.code in MIXED_JOYSTICK_KEYS) {
        // Joystick path
        const dir = MIXED_JOYSTICK_KEYS[event.code];
        this.emulator.joystickPush(
          this.keyboardJoystickPort,
          dir as import('./constants').JoystickInput,
        );
        event.preventDefault();
      } else {
        // Keyboard path — but exclude the joystick codes from matrix so
        // they don't double-fire (they were handled above).
        const acts = domKeyToC64Actions(event.key, event.shiftKey, 'keydown');
        if (acts.length > 0) {
          for (const act of acts) {
            if (act.action === 'press') this.emulator.keyDown(act.key);
            else this.emulator.keyUp(act.key);
          }
          event.preventDefault();
        }
      }
      return;
    }

    // Default: joystick-only mode
    const control = this.getMappedControl(event);
    if (!control || this.pressedControls.has(control)) {
      return;
    }
    this.pressedControls.add(control);
    this.emulator.joystickPush(this.keyboardJoystickPort, KEY_TO_JOYSTICK[control]);
    event.preventDefault();
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (this.inputMode === 'keyboard') {
      const acts = domKeyToC64Actions(event.key, event.shiftKey, 'keyup');
      if (acts.length > 0) {
        for (const act of acts) {
          if (act.action === 'press') this.emulator.keyDown(act.key);
          else this.emulator.keyUp(act.key);
        }
        event.preventDefault();
      }
      return;
    }

    if (this.inputMode === 'mixed') {
      if (event.code in MIXED_JOYSTICK_KEYS) {
        const dir = MIXED_JOYSTICK_KEYS[event.code];
        this.emulator.joystickRelease(
          this.keyboardJoystickPort,
          dir as import('./constants').JoystickInput,
        );
        event.preventDefault();
      } else {
        const acts = domKeyToC64Actions(event.key, event.shiftKey, 'keyup');
        if (acts.length > 0) {
          for (const act of acts) {
            if (act.action === 'press') this.emulator.keyDown(act.key);
            else this.emulator.keyUp(act.key);
          }
          event.preventDefault();
        }
      }
      return;
    }

    // Default: joystick-only mode
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
    if (this.keyboardJoystickPort === port) return;
    this.releaseAll();
    this.keyboardJoystickPort = port;
  }

  /** Set the input mode. Releases any held joystick buttons on mode change. */
  setInputMode(mode: InputMode): void {
    if (this.inputMode === mode) return;
    this.releaseAll();
    this.inputMode = mode;
  }

  getInputMode(): InputMode {
    return this.inputMode;
  }
}
