import { describe, expect, it } from 'vitest';
import {
  resolveGameFromParam,
  resolveUrlFromParam,
  shouldDisableDefaultGameForCheevos,
  toViteFsUrl,
} from '../../src/player/startup-params';

describe('startup URL params', () => {
  it('loads the default game when no game or cheevos set is provided', () => {
    const params = new URLSearchParams('');

    expect(shouldDisableDefaultGameForCheevos(params)).toBe(false);
    expect(resolveGameFromParam(params.get('game'), '/c64-ready/', { disableDefault: false })).toBe(
      '/c64-ready/games/cartridges/legend-of-wilf.crt',
    );
  });

  it('disables the default game when cheevos and cheevosSet are loaded from the URL', () => {
    const params = new URLSearchParams('cheevos=rainbow-islands&cheevosSet=/@fs/game.json');

    expect(shouldDisableDefaultGameForCheevos(params)).toBe(true);
    expect(resolveGameFromParam(params.get('game'), '/c64-ready/', { disableDefault: true })).toBe(
      '',
    );
  });

  it('honors an explicit game param even with URL-loaded cheevos', () => {
    const params = new URLSearchParams(
      'game=games/demo.crt&cheevos=rainbow-islands&cheevosSet=/@fs/game.json',
    );

    expect(shouldDisableDefaultGameForCheevos(params)).toBe(false);
    expect(resolveGameFromParam(params.get('game'), '/c64-ready/', { disableDefault: false })).toBe(
      '/c64-ready/games/demo.crt',
    );
  });

  it('resolves Vite /@fs cheevos set URLs under the configured base', () => {
    expect(resolveUrlFromParam('/@fs/home/me/set.json', '/c64-ready/')).toBe(
      '/c64-ready/@fs/home/me/set.json',
    );
  });

  it('converts absolute local paths into Vite /@fs URLs', () => {
    expect(toViteFsUrl('/home/me/set.json', '/c64-ready/')).toBe('/@fs/home/me/set.json');
    expect(toViteFsUrl('/c64-ready/@fs/home/me/set.json', '/c64-ready/')).toBe(
      '/@fs/home/me/set.json',
    );
  });
});
