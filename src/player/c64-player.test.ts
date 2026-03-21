import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C64Player } from './c64-player';
import { C64Emulator } from '../emulator/c64-emulator';

describe('C64Player', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeFakeEmulator() {
    return {
      loadGame: vi.fn(),
      start: vi.fn(),
    } as any;
  }

  function makeFakeRenderer() {
    return {
      attachTo: vi.fn(),
    } as any;
  }

  function stubFetchForGame(data: Uint8Array = new Uint8Array([1, 2, 3, 4])) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(data.buffer),
      }),
    );
  }

  // ── start() ─────────────────────────────────────────────────────────────

  it('start() loads wasm, wires renderer and input, loads game, and starts', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame();

    const renderer = makeFakeRenderer();
    const onProgress = vi.fn();

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '/games/test.crt',
      renderer,
      onProgress,
    });

    await player.start();

    expect(C64Emulator.load).toHaveBeenCalledWith('/c64.wasm');
    expect(renderer.attachTo).toHaveBeenCalledWith(emulator);
    expect(emulator.loadGame).toHaveBeenCalledOnce();
    expect(emulator.start).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(10, 'INITIALISING WASM...');
    expect(onProgress).toHaveBeenCalledWith(100, 'READY!');
  });

  // ── loadGame() ──────────────────────────────────────────────────────────

  it('fetches a game file and loads it into the emulator', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame(new Uint8Array([1, 2, 3, 4]));

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '/games/initial.crt',
      renderer: makeFakeRenderer(),
    });
    await player.start();

    // Load a second game
    await player.loadGame('/games/test.crt', 'crt');

    expect(fetch).toHaveBeenCalledWith('/games/test.crt');
    // loadGame called twice: once during start(), once manually
    const call = emulator.loadGame.mock.calls[1][0];
    expect(call.type).toBe('crt');
    expect(Array.from(call.data)).toEqual([1, 2, 3, 4]);
  });

  it('reports progress via callback when content-length is available', async () => {
    const chunk1 = new Uint8Array([10, 20]);
    const chunk2 = new Uint8Array([30, 40, 50]);

    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);

    // First fetch (for start) returns simple data
    const startFetch = {
      ok: true,
      headers: new Headers(),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
    };

    // Second fetch (for loadGame) returns streamed chunks
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: chunk1 })
        .mockResolvedValueOnce({ done: false, value: chunk2 })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    const streamedFetch = {
      ok: true,
      headers: new Headers({ 'content-length': '5' }),
      body: { getReader: () => reader },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(startFetch).mockResolvedValueOnce(streamedFetch),
    );

    const onProgress = vi.fn();
    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '/games/initial.crt',
      renderer: makeFakeRenderer(),
    });
    await player.start();

    await player.loadGame('/games/test.crt', 'crt', onProgress);

    expect(onProgress).toHaveBeenCalledWith(20, 'LOADING GAME...');
    expect(onProgress).toHaveBeenCalledWith(90, 'INSERTING CARTRIDGE...');
    expect(onProgress).toHaveBeenCalledWith(100, 'READY!');

    const call = emulator.loadGame.mock.calls[1][0];
    expect(Array.from(call.data)).toEqual([10, 20, 30, 40, 50]);
  });

  it('throws when fetch fails during loadGame', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame();

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '/games/initial.crt',
      renderer: makeFakeRenderer(),
    });
    await player.start();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(player.loadGame('/missing.crt')).rejects.toThrow('Failed to fetch game: 404');
  });

  it('throws when loadGame called before start', async () => {
    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '/games/test.crt',
      renderer: makeFakeRenderer(),
    });

    await expect(player.loadGame('/games/test.crt')).rejects.toThrow('Emulator not initialised');
  });

  it('defaults to crt game type', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame();

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '/games/test.crt',
      renderer: makeFakeRenderer(),
    });
    await player.start();

    expect(emulator.loadGame.mock.calls[0][0].type).toBe('crt');
  });

  it('supports prg game type via options', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame();

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '/games/test.prg',
      gameType: 'prg',
      renderer: makeFakeRenderer(),
    });
    await player.start();

    expect(emulator.loadGame.mock.calls[0][0].type).toBe('prg');
  });

  it('works without a progress callback', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame();

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '/games/test.crt',
      renderer: makeFakeRenderer(),
    });

    await player.start();
    expect(emulator.loadGame).toHaveBeenCalledOnce();
    expect(emulator.start).toHaveBeenCalledOnce();
  });
});
