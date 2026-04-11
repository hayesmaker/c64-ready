/**
 * c64-key-map.mjs
 *
 * Maps browser KeyboardEvent.key strings → C64 matrix key indices.
 * Extracted from c64.js (keyCodeToMatrixIndex) so the headless input
 * server can translate remote keyboard events correctly.
 *
 * Usage:
 *   import { domKeyToC64 } from './c64-key-map.mjs';
 *   const result = domKeyToC64(event.key, event.shiftKey, event.type);
 *   // result: { index: number, shiftDown?: true, shiftUp?: true }
 *   // index -1 means unmapped / ignore
 */

// C64 keyboard matrix indices (matches C64_KEY_* constants in c64.js)
export const C64_KEY = {
  ARROW_LEFT:       0,   // ← (top-left key)
  ONE:              1,
  TWO:              2,
  THREE:            3,
  FOUR:             4,
  FIVE:             5,
  SIX:              6,
  SEVEN:            7,
  EIGHT:            8,
  NINE:             9,
  ZERO:             10,
  PLUS:             11,
  MINUS:            12,
  POUND:            13,
  CLEAR_HOME:       14,
  INS_DEL:          15,
  CTRL:             16,
  Q:                17,
  W:                18,
  E:                19,
  R:                20,
  T:                21,
  Y:                22,
  U:                23,
  I:                24,
  O:                25,
  P:                26,
  AT:               27,
  STAR:             28,
  ARROW_UP:         29,  // ↑ (pi / power key)
  RUN_STOP:         30,
  A:                31,
  S:                32,
  D:                33,
  F:                34,
  G:                35,
  H:                36,
  J:                37,
  K:                38,
  L:                39,
  COLON:            40,
  SEMICOLON:        41,
  EQUALS:           42,
  RETURN:           43,
  COMMODORE:        44,
  SHIFT_LEFT:       45,
  Z:                46,
  X:                47,
  C:                48,
  V:                49,
  B:                50,
  N:                51,
  M:                52,
  COMMA:            53,
  PERIOD:           54,
  SLASH:            55,
  SHIFT_RIGHT:      56,
  CURSOR_UP_DOWN:   57,
  CURSOR_LEFT_RIGHT:58,
  SPACE:            59,
  F1:               60,
  F3:               61,
  F5:               62,
  F7:               63,
  RESTORE:          64,
};

/**
 * Translate a browser key event into C64 matrix actions.
 *
 * Returns an array of { key: C64_KEY_INDEX, action: 'press'|'release' }
 * to apply in order. Handles shift-key side-effects for cursor keys, etc.
 *
 * @param {string}  domKey    - KeyboardEvent.key (e.g. 'a', 'ArrowUp', 'Enter')
 * @param {boolean} shiftKey  - KeyboardEvent.shiftKey
 * @param {'keydown'|'keyup'} eventType
 * @returns {Array<{key: number, action: 'press'|'release'}>}
 */
export function domKeyToC64Actions(domKey, shiftKey, eventType) {
  const k = domKey.toLowerCase();
  const isDown = eventType === 'keydown';
  const actions = [];

  const press   = (idx) => actions.push({ key: idx, action: 'press' });
  const release = (idx) => actions.push({ key: idx, action: 'release' });
  const main    = (idx) => actions.push({ key: idx, action: isDown ? 'press' : 'release' });

  // Handle host shift state first for plain alpha/numeric keys
  if (isDown) {
    if (shiftKey) {
      press(C64_KEY.SHIFT_LEFT);
    } else {
      // Release both shifts on unshifted keys (except cursor up/left which use shift internally)
      if (k !== 'arrowup' && k !== 'arrowleft') {
        release(C64_KEY.SHIFT_LEFT);
        release(C64_KEY.SHIFT_RIGHT);
      }
    }
  }

  switch (k) {
    // ── Letters ─────────────────────────────────────────────────────────────
    case 'a': main(C64_KEY.A); break;
    case 'b': main(C64_KEY.B); break;
    case 'c': main(C64_KEY.C); break;
    case 'd': main(C64_KEY.D); break;
    case 'e': main(C64_KEY.E); break;
    case 'f': main(C64_KEY.F); break;
    case 'g': main(C64_KEY.G); break;
    case 'h': main(C64_KEY.H); break;
    case 'i': main(C64_KEY.I); break;
    case 'j': main(C64_KEY.J); break;
    case 'k': main(C64_KEY.K); break;
    case 'l': main(C64_KEY.L); break;
    case 'm': main(C64_KEY.M); break;
    case 'n': main(C64_KEY.N); break;
    case 'o': main(C64_KEY.O); break;
    case 'p': main(C64_KEY.P); break;
    case 'q': main(C64_KEY.Q); break;
    case 'r': main(C64_KEY.R); break;
    case 's': main(C64_KEY.S); break;
    case 't': main(C64_KEY.T); break;
    case 'u': main(C64_KEY.U); break;
    case 'v': main(C64_KEY.V); break;
    case 'w': main(C64_KEY.W); break;
    case 'x': main(C64_KEY.X); break;
    case 'y': main(C64_KEY.Y); break;
    case 'z': main(C64_KEY.Z); break;

    // ── Numbers ──────────────────────────────────────────────────────────────
    case '0': main(C64_KEY.ZERO);  break;
    case '1': main(C64_KEY.ONE);   break;
    case '2': main(C64_KEY.TWO);   break;
    case '3': main(C64_KEY.THREE); break;
    case '4': main(C64_KEY.FOUR);  break;
    case '5': main(C64_KEY.FIVE);  break;
    case '6': main(C64_KEY.SIX);   break;
    case '7': main(C64_KEY.SEVEN); break;
    case '8': main(C64_KEY.EIGHT); break;
    case '9': main(C64_KEY.NINE);  break;

    // ── Shifted number row (!, ", £, $, %, etc.) ────────────────────────────
    case '!': if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.ONE);   break;
    case '"': if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.TWO);   break;
    case '#': if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.THREE); break;
    case '$': if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.FOUR);  break;
    case '%': if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.FIVE);  break;
    case '&': if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.SIX);   break;
    case "'": if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.SEVEN); break;
    case '(': if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.EIGHT); break;
    case ')': if (isDown) press(C64_KEY.SHIFT_LEFT);   else release(C64_KEY.SHIFT_LEFT); main(C64_KEY.NINE);  break;

    // ── Symbols ──────────────────────────────────────────────────────────────
    case ' ':         main(C64_KEY.SPACE);    break;
    case 'enter':     main(C64_KEY.RETURN);   break;
    case 'backspace':
    case 'delete':    main(C64_KEY.INS_DEL);  break;
    case 'escape':    main(C64_KEY.RUN_STOP); break;
    case '-':         main(C64_KEY.MINUS);    break;
    case '=':         main(C64_KEY.EQUALS);   break;
    case '+':         // unshifted + on C64 keyboard
      if (isDown) { release(C64_KEY.SHIFT_LEFT); release(C64_KEY.SHIFT_RIGHT); }
      main(C64_KEY.PLUS); break;
    case '*':
      if (isDown) { release(C64_KEY.SHIFT_LEFT); release(C64_KEY.SHIFT_RIGHT); }
      main(C64_KEY.STAR); break;
    case '@':
      if (isDown) { release(C64_KEY.SHIFT_LEFT); release(C64_KEY.SHIFT_RIGHT); }
      main(C64_KEY.AT); break;
    case '^':
      if (isDown) { release(C64_KEY.SHIFT_LEFT); release(C64_KEY.SHIFT_RIGHT); }
      main(C64_KEY.ARROW_UP); break;
    case '`':         main(C64_KEY.ARROW_LEFT); break;
    case '~':         main(C64_KEY.ARROW_UP);   break;
    case '\\':        main(C64_KEY.POUND);       break;
    case ',':
    case '<':         main(C64_KEY.COMMA);   break;
    case '.':
    case '>':         main(C64_KEY.PERIOD);  break;
    case '/':
    case '?':         main(C64_KEY.SLASH);   break;
    case ';':         main(C64_KEY.SEMICOLON); break;
    case ':':
      if (isDown) { release(C64_KEY.SHIFT_LEFT); release(C64_KEY.SHIFT_RIGHT); }
      main(C64_KEY.COLON); break;
    case '[':
      if (isDown) press(C64_KEY.SHIFT_LEFT); else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.COLON); break;
    case ']':
      if (isDown) press(C64_KEY.SHIFT_LEFT); else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.SEMICOLON); break;

    // ── Modifier / special keys ───────────────────────────────────────────────
    case 'shift':     main(C64_KEY.SHIFT_LEFT);  break;
    case 'tab':       main(C64_KEY.CTRL);        break;   // Tab → C64 CTRL
    case 'control':   main(C64_KEY.COMMODORE);   break;   // Ctrl → CBM key
    case 'capslock':  main(C64_KEY.COMMODORE);   break;   // CapsLock → CBM key
    case 'home':      main(C64_KEY.CLEAR_HOME);  break;
    case 'pageup':    main(C64_KEY.RESTORE);     break;

    // ── Function keys ────────────────────────────────────────────────────────
    case 'f1':  main(C64_KEY.F1); break;
    case 'f2':  // F2 = Shift+F1
      if (isDown) press(C64_KEY.SHIFT_LEFT); else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.F1); break;
    case 'f3':  main(C64_KEY.F3); break;
    case 'f4':
      if (isDown) press(C64_KEY.SHIFT_LEFT); else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.F3); break;
    case 'f5':  main(C64_KEY.F5); break;
    case 'f6':
      if (isDown) press(C64_KEY.SHIFT_LEFT); else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.F5); break;
    case 'f7':  main(C64_KEY.F7); break;
    case 'f8':
      if (isDown) press(C64_KEY.SHIFT_LEFT); else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.F7); break;

    // ── Cursor keys ───────────────────────────────────────────────────────────
    // Down / Right are unshifted. Up / Left use Shift+cursor key.
    case 'arrowdown':
      main(C64_KEY.CURSOR_UP_DOWN); break;
    case 'arrowup':
      if (isDown) press(C64_KEY.SHIFT_LEFT); else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.CURSOR_UP_DOWN); break;
    case 'arrowright':
      main(C64_KEY.CURSOR_LEFT_RIGHT); break;
    case 'arrowleft':
      if (isDown) press(C64_KEY.SHIFT_LEFT); else release(C64_KEY.SHIFT_LEFT);
      main(C64_KEY.CURSOR_LEFT_RIGHT); break;

    default:
      // Unmapped key — return empty array (caller should ignore)
      break;
  }

  return actions;
}
