import { describe, expect, it } from 'vitest';
import { C64_KEY } from '../../src/emulator/c64-keys';
import { JOYSTICK_DIRECTION, JOYSTICK_FIRE_1 } from '../../src/emulator/constants';
import {
  DEFAULT_GAMEPAD_MAPPING,
  readGamepadState,
  resolveGamepadMapping,
  resolveOutputs,
  restrictDirections,
} from '../../src/emulator/gamepad-mapping';

function pad({ buttons = [] as number[], axes = [] as number[] } = {}): Gamepad {
  return {
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), value: 0 })),
    axes,
  } as unknown as Gamepad;
}

describe('resolveGamepadMapping', () => {
  it('defaults to the original mapping', () => {
    expect(resolveGamepadMapping()).toEqual(DEFAULT_GAMEPAD_MAPPING);
    expect(resolveGamepadMapping(null)).toEqual(DEFAULT_GAMEPAD_MAPPING);
  });

  it('overrides only the listed controls, and null unmaps one', () => {
    const mapping = resolveGamepadMapping({
      stick: '2way',
      directions: { left: { key: C64_KEY.A } },
      buttons: { b: null, lb: { joystick: 'fire' } },
    });
    expect(mapping.stick).toBe('2way');
    expect(mapping.directions.left).toEqual({ key: C64_KEY.A });
    expect(mapping.directions.right).toEqual({ joystick: 'right' });
    expect(mapping.buttons.b).toBeNull();
    expect(mapping.buttons.lb).toEqual({ joystick: 'fire' });
    expect(mapping.buttons.a).toEqual({ joystick: 'fire' });
  });

  it('ignores invalid values', () => {
    const mapping = resolveGamepadMapping({
      stick: 'diagonal' as never,
      buttons: { a: { key: 999 }, x: { joystick: 'jump' } as never },
    });
    expect(mapping.stick).toBe('8way');
    expect(mapping.buttons.a).toEqual({ joystick: 'fire' });
    expect(mapping.buttons.x).toEqual({ key: C64_KEY.SPACE });
  });
});

describe('readGamepadState', () => {
  it('reads the D-pad, left stick and D-pad axes as directions', () => {
    expect(readGamepadState(pad({ buttons: [12] })).up).toBe(true);
    expect(readGamepadState(pad({ axes: [-0.9, 0] })).left).toBe(true);
    expect(readGamepadState(pad({ axes: [0, 0, 0, 0, 0, 0, 0, 1] })).down).toBe(true);
    expect(readGamepadState(pad({ axes: [0.2, -0.2] }))).toMatchObject({
      up: false,
      down: false,
      left: false,
      right: false,
    });
  });

  it('reads the face, shoulder and trigger buttons and Start', () => {
    const state = readGamepadState(pad({ buttons: [0, 3, 4, 7, 9] }));
    expect(state).toMatchObject({ a: true, b: false, y: true, lb: true, rt: true, start: true });
  });
});

describe('restrictDirections', () => {
  const diagonal = { up: true, right: true };

  it('keeps diagonals in 8-way mode', () => {
    expect(restrictDirections(diagonal, '8way')).toEqual({ up: true, down: false, left: false, right: true });
  });

  it('drops up and down in 2-way mode', () => {
    expect(restrictDirections(diagonal, '2way')).toEqual({ up: false, down: false, left: false, right: true });
  });

  it('keeps the direction already held in 4-way mode', () => {
    expect(restrictDirections(diagonal, '4way', { up: true })).toEqual({
      up: true,
      down: false,
      left: false,
      right: false,
    });
    expect(restrictDirections(diagonal, '4way', { right: true })).toEqual({
      up: false,
      down: false,
      left: false,
      right: true,
    });
  });

  it('goes horizontal for a fresh diagonal in 4-way mode', () => {
    expect(restrictDirections(diagonal, '4way')).toEqual({ up: false, down: false, left: false, right: true });
  });

  it('cancels opposite directions', () => {
    expect(restrictDirections({ left: true, right: true }, '8way')).toEqual({
      up: false,
      down: false,
      left: false,
      right: false,
    });
  });
});

describe('resolveOutputs', () => {
  it('maps held controls to joystick bits and keys, once each', () => {
    const outputs = resolveOutputs({ up: true, a: true, b: true, x: true }, DEFAULT_GAMEPAD_MAPPING);
    expect([...outputs.values()]).toEqual([
      { joystick: JOYSTICK_DIRECTION.UP },
      { joystick: JOYSTICK_FIRE_1 },
      { key: C64_KEY.SPACE },
    ]);
  });
});
