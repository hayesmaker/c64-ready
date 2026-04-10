import { describe, expect, it } from 'vitest';
import {
  getAcceptForLoadTypeSelection,
  inferLoadTypeFromFilename,
  resolveLoadTypeSelection,
} from '../../src/player/load-formats';

describe('load-formats', () => {
  it('infers load type by file extension', () => {
    expect(inferLoadTypeFromFilename('demo.CRT')).toBe('crt');
    expect(inferLoadTypeFromFilename('intro.prg')).toBe('prg');
    expect(inferLoadTypeFromFilename('disk.d64')).toBe('d64');
    expect(inferLoadTypeFromFilename('state.c64')).toBe('snapshot');
    expect(inferLoadTypeFromFilename('state.vsf')).toBeNull();
    expect(inferLoadTypeFromFilename('unknown.bin')).toBeNull();
  });

  it('resolves auto selection with fallback', () => {
    expect(resolveLoadTypeSelection('auto', 'game.prg')).toBe('prg');
    expect(resolveLoadTypeSelection('auto', 'unknown.bin')).toBe('crt');
    expect(resolveLoadTypeSelection('auto', 'unknown.bin', 'd64')).toBe('d64');
    expect(resolveLoadTypeSelection('crt', 'ignored.prg')).toBe('crt');
  });

  it('returns accept strings for chooser filtering', () => {
    expect(getAcceptForLoadTypeSelection('crt')).toBe('.crt');
    expect(getAcceptForLoadTypeSelection('auto')).toContain('.d64');
  });
});
