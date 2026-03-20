import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C64Player } from './c64-player';

describe('C64Player', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeFakeEmulator() {
    return {
      loadGame: vi.fn(),
    } as any;
  }

  it('fetches a game file and loads it into the emulator', async () => {
    const gameData = new Uint8Array([1, 2, 3, 4]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      arrayBuffer: vi.fn().mockResolvedValue(gameData.buffer),
    }));

    const emulator = makeFakeEmulator();
    const player = new C64Player(emulator);

    await player.loadGame('/games/test.crt', 'crt');

    expect(fetch).toHaveBeenCalledWith('/games/test.crt');
    expect(emulator.loadGame).toHaveBeenCalledOnce();

    const call = emulator.loadGame.mock.calls[0][0];
    expect(call.type).toBe('crt');
    expect(Array.from(call.data)).toEqual([1, 2, 3, 4]);
  });

  it('reports progress via callback when content-length is available', async () => {
    const chunk1 = new Uint8Array([10, 20]);
    const chunk2 = new Uint8Array([30, 40, 50]);

    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: chunk1 })
        .mockResolvedValueOnce({ done: false, value: chunk2 })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '5' }),
      body: { getReader: () => reader },
    }));

    const emulator = makeFakeEmulator();
    const player = new C64Player(emulator);
    const onProgress = vi.fn();

    await player.loadGame('/games/test.crt', 'crt', onProgress);

    // Should have been called: start, chunk1, chunk2, inserting, ready
    expect(onProgress).toHaveBeenCalledWith(0, 'LOADING GAME...');
    expect(onProgress).toHaveBeenCalledWith(95, 'INSERTING CARTRIDGE...');
    expect(onProgress).toHaveBeenCalledWith(100, 'READY!');

    // The loaded data should be the concatenation of both chunks
    const call = emulator.loadGame.mock.calls[0][0];
    expect(Array.from(call.data)).toEqual([10, 20, 30, 40, 50]);
  });

  it('throws when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const emulator = makeFakeEmulator();
    const player = new C64Player(emulator);

    await expect(player.loadGame('/missing.crt')).rejects.toThrow('Failed to fetch game: 404');
    expect(emulator.loadGame).not.toHaveBeenCalled();
  });

  it('defaults to crt type when not specified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2)),
    }));

    const emulator = makeFakeEmulator();
    const player = new C64Player(emulator);

    await player.loadGame('/games/test.crt');

    expect(emulator.loadGame.mock.calls[0][0].type).toBe('crt');
  });

  it('supports prg type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2)),
    }));

    const emulator = makeFakeEmulator();
    const player = new C64Player(emulator);

    await player.loadGame('/games/test.prg', 'prg');

    expect(emulator.loadGame.mock.calls[0][0].type).toBe('prg');
  });

  it('works without a progress callback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
    }));

    const emulator = makeFakeEmulator();
    const player = new C64Player(emulator);

    // Should not throw when no callback provided
    await player.loadGame('/games/test.crt');
    expect(emulator.loadGame).toHaveBeenCalledOnce();
  });
});

