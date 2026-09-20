import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheevosDevController, { parseCheevosSetJson } from '../../src/player/cheevos-dev';
import { createCheevos } from 'c64-cheevos';

vi.mock('c64-cheevos', () => ({
  createCheevos: vi.fn(),
}));

describe('CheevosDevController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  function makePlayer() {
    return {
      cpuReadNS: vi.fn(() => 11),
      cpuRead: vi.fn(() => 22),
      ramRead: vi.fn(() => 33),
    } as any;
  }

  it('creates cheevos, attaches memory readers, and starts polling', async () => {
    const execute = vi.fn();
    vi.mocked(createCheevos).mockResolvedValue({ execute });
    const player = makePlayer();
    const controller = new CheevosDevController(player);

    await controller.enable(' Uridium ', {
      _id: 'set1',
      cheevos: [{ _id: 'zinc', title: 'Zinc', description: 'Clear level 1' }],
    });

    expect(createCheevos).toHaveBeenCalledWith(
      'uridium',
      expect.objectContaining({
        gameId: 'uridium',
        cheevosSet: expect.objectContaining({ _id: 'set1' }),
      }),
    );
    const instance = await vi.mocked(createCheevos).mock.results[0]!.value;
    expect(instance.cpuReadNS?.(0x10)).toBe(11);
    expect(instance.cpuRead?.(0x20)).toBe(22);
    expect(instance.ramRead?.(0x30)).toBe(33);
    expect(execute).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it('stores scores and popped achievements through host callbacks', async () => {
    const createMock = vi.mocked(createCheevos);
    createMock.mockResolvedValue({ execute: vi.fn() });
    const controller = new CheevosDevController(makePlayer());

    await controller.enable('mario-cf', {
      _id: 'set1',
      cheevos: [{ _id: 'first', title: 'First Steps', description: 'Start' }],
    });

    const options = createMock.mock.calls[0]![1] as any;
    await options.postScore('mario-cf', 1234, 'dev-user', 'Developer');
    const popResult = await options.popCheevo('set1', 'dev-user', 'first');

    expect(popResult.achievement.title).toBe('First Steps');
    expect(JSON.parse(localStorage.getItem('c64-cheevos-dev:mario-cf:scores') ?? '[]')).toEqual([
      expect.objectContaining({ gameId: 'mario-cf', score: 1234 }),
    ]);
    expect(JSON.parse(localStorage.getItem('c64-cheevos-dev:mario-cf:popped') ?? '[]')).toEqual([
      { achievement: { _id: 'first', title: 'First Steps', description: 'Start' } },
    ]);
  });

  it('parses achievement set JSON', () => {
    expect(parseCheevosSetJson('{"_id":"set1","cheevos":[{"_id":"a","title":"A"}]}')).toEqual({
      _id: 'set1',
      cheevos: [{ _id: 'a', title: 'A', description: '' }],
    });
  });
});
