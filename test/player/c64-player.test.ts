import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C64Player } from '../../src/player/c64-player';
import { C64Emulator } from '../../src/emulator/c64-emulator';

describe('C64Player', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeFakeEmulator() {
    return {
      loadGame: vi.fn(),
      start: vi.fn(),
      setSampleRate: vi.fn(),
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

  // ...additional tests omitted for brevity
});

