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
      reboot: vi.fn().mockResolvedValue(undefined),
      setCrtPreloadChecksEnabled: vi.fn(),
      isRunning: vi.fn(() => true),
      keyDown: vi.fn(),
      keyUp: vi.fn(),
      setSampleRate: vi.fn(),
    } as any;
  }

  function makeFakeRenderer() {
    return {
      attachTo: vi.fn(),
    } as any;
  }

  function stubFetchForGame(data?: Uint8Array) {
    // Provide a minimal valid CRT header (0x40 bytes) so parseCrtInfo passes.
    // Layout mirrors the real CRT spec:
    //   0x00  "C64 CARTRIDGE   " (16 bytes, space-padded)
    //   0x10  header length = 0x40 (big-endian u32)
    //   0x16  hwType = 0 (Normal cartridge, big-endian u16)
    //   0x18  exrom = 1, game = 1 (inactive / pass-through)
    if (!data) {
      data = new Uint8Array(0x40);
      const sig = 'C64 CARTRIDGE   ';
      for (let i = 0; i < 16; i++) data[i] = sig.charCodeAt(i);
      // header length = 0x40
      data[0x10] = 0;
      data[0x11] = 0;
      data[0x12] = 0;
      data[0x13] = 0x40;
      // hwType = 0
      data[0x16] = 0;
      data[0x17] = 0;
      // exrom = 1, game = 1
      data[0x18] = 1;
      data[0x19] = 1;
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(data.buffer),
      }),
    );
  }

  function makeCrtData(exrom: number, game: number, hwType: number = 0): Uint8Array {
    const data = new Uint8Array(0x40);
    const sig = 'C64 CARTRIDGE   ';
    for (let i = 0; i < 16; i++) data[i] = sig.charCodeAt(i);
    data[0x10] = 0;
    data[0x11] = 0;
    data[0x12] = 0;
    data[0x13] = 0x40;
    data[0x16] = (hwType >> 8) & 0xff;
    data[0x17] = hwType & 0xff;
    data[0x18] = exrom;
    data[0x19] = game;
    return data;
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

  it('auto-types RUN after loading a PRG file', async () => {
    vi.useFakeTimers();
    try {
      const emulator = makeFakeEmulator();
      vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
      stubFetchForGame();

      const player = new C64Player({
        wasmUrl: '/c64.wasm',
        gameUrl: '/games/test.crt',
        renderer: makeFakeRenderer(),
      });

      await player.start();

      const prg = {
        name: 'demo.prg',
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
      } as unknown as File;

      const loadPromise = player.loadFile(prg, 'prg');
      await vi.advanceTimersByTimeAsync(1500);
      await loadPromise;

      expect(emulator.loadGame).toHaveBeenCalledWith({
        type: 'prg',
        data: expect.any(Uint8Array),
      });
      expect(emulator.keyDown).toHaveBeenCalled();
      expect(emulator.keyUp).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts emulator without autoload when gameUrl is empty', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '',
      renderer: makeFakeRenderer(),
    });

    await player.start();

    expect(emulator.loadGame).not.toHaveBeenCalled();
    expect(emulator.start).toHaveBeenCalledOnce();
  });

  it('reboot() re-instantiates the player runtime and emits c64-reboot', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame();

    const renderer = makeFakeRenderer();
    const player = new C64Player({ wasmUrl: '/c64.wasm', gameUrl: '', renderer });
    const rebootListener = vi.fn();
    window.addEventListener('c64-reboot', rebootListener);

    try {
      await player.start();
      await player.reboot();
    } finally {
      window.removeEventListener('c64-reboot', rebootListener);
    }

    expect(emulator.reboot).toHaveBeenCalledOnce();
    expect(renderer.attachTo).toHaveBeenCalledTimes(2);
    expect(emulator.start).toHaveBeenCalledTimes(2);
    expect(rebootListener).toHaveBeenCalledOnce();
  });

  it('rejects Ultimax CRT in browser load path and dispatches c64-load-error', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame(makeCrtData(1, 0));

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '',
      renderer: makeFakeRenderer(),
    });

    await player.start();

    const errorListener = vi.fn();
    window.addEventListener('c64-load-error', errorListener);
    try {
      await expect(player.loadGame('/games/billiards.crt', 'crt')).rejects.toThrow(
        'Unsupported CRT: Ultimax/MAX cartridges are not supported by this emulator.',
      );
    } finally {
      window.removeEventListener('c64-load-error', errorListener);
    }

    expect(emulator.loadGame).not.toHaveBeenCalledWith({ type: 'crt', data: expect.anything() });
    expect(errorListener).toHaveBeenCalledOnce();
  });

  it('allows Ultimax-flagged EasyFlash CRT in browser load path', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame(makeCrtData(1, 0, 32));

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '',
      renderer: makeFakeRenderer(),
    });

    await player.start();
    await player.loadGame('/games/legend-of-wilf.crt', 'crt');

    expect(emulator.loadGame).toHaveBeenCalledWith({ type: 'crt', data: expect.any(Uint8Array) });
  });

  it('allows unsupported CRT when preload checks are disabled', async () => {
    const emulator = makeFakeEmulator();
    vi.spyOn(C64Emulator, 'load').mockResolvedValue(emulator);
    stubFetchForGame(makeCrtData(1, 0, 0));

    const player = new C64Player({
      wasmUrl: '/c64.wasm',
      gameUrl: '',
      renderer: makeFakeRenderer(),
    });

    await player.start();
    player.setCrtPreloadChecksDisabled(true);
    const infoListener = vi.fn();
    window.addEventListener('c64-load-info', infoListener);
    await player.loadGame('/games/billiards.crt', 'crt');
    window.removeEventListener('c64-load-info', infoListener);

    expect(emulator.setCrtPreloadChecksEnabled).toHaveBeenLastCalledWith(false);
    expect(emulator.loadGame).toHaveBeenCalledWith({ type: 'crt', data: expect.any(Uint8Array) });
    expect(infoListener).toHaveBeenCalled();
    expect(infoListener.mock.calls.some((c) => c[0]?.detail?.mode === 'warning')).toBe(true);
  });

  it('delegates active gamepad selection through the input handler', () => {
    const player = new C64Player({ wasmUrl: '/c64.wasm', gameUrl: '', renderer: makeFakeRenderer() });
    const inputHandler = {
      setActiveGamepadIndex: vi.fn(),
      getActiveGamepadIndex: vi.fn(() => 4),
    };

    (player as unknown as { inputHandler: typeof inputHandler }).inputHandler = inputHandler;

    player.setActiveGamepadIndex(2);

    expect(inputHandler.setActiveGamepadIndex).toHaveBeenCalledWith(2);
    expect(player.getActiveGamepadIndex()).toBe(4);
  });

  // ...additional tests omitted for brevity
});
