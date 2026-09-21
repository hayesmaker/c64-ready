import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCheevosRomPath,
  getCheevosRomType,
  getStoredCheevosRom,
} from '../../src/player/local-rom-store';

describe('local cheevos ROM metadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads top-level romPath and infers the ROM type', () => {
    const set = { romPath: '~/C64/Uridium.d64' };

    expect(getCheevosRomPath(set)).toBe('~/C64/Uridium.d64');
    expect(getCheevosRomType(set)).toBe('d64');
  });

  it('supports nested rom metadata and explicit type', () => {
    const set = { rom: { path: '~/C64/Uridium.bin', type: 'crt' } };

    expect(getCheevosRomPath(set)).toBe('~/C64/Uridium.bin');
    expect(getCheevosRomType(set)).toBe('crt');
  });

  it('does not request file permissions when no cached ROM store is available', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await expect(getStoredCheevosRom('~/C64/Uridium.d64', 'd64')).resolves.toBeNull();
  });
});
