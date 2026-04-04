import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C64Emulator } from '../../src/emulator/c64-emulator';
import { C64WASM } from '../../src/emulator/c64-wasm';

const FRAME_BYTES = 384 * 272 * 4;

describe('C64Emulator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeFakeWasm({ pcSequence }: { pcSequence?: number[] } = {}) {
    const heapU8 = new Uint8Array(FRAME_BYTES + 64);
    for (let i = 0; i < 16; i++) {
      heapU8[i] = i + 1;
    }

    const heapF32 = new Float32Array(4096 + 32);
    heapF32[0] = 0.25;
    heapF32[1] = -0.5;

    // c64_getPC returns successive values from pcSequence (cycling) so tests
    // can simulate either a running machine (multiple distinct PCs) or a stuck
    // machine (all values the same).
    let pcCallIndex = 0;
    const defaultPcSequence = [0x1000, 0x1002, 0x1004, 0x1006];
    const resolvedPcSeq = pcSequence ?? defaultPcSequence;

    const exports = {
      c64_init: vi.fn(),
      c64_reset: vi.fn(),
      debugger_update: vi.fn(() => 1),
      debugger_play: vi.fn(),
      debugger_pause: vi.fn(),
      debugger_step: vi.fn(),
      debugger_set_speed: vi.fn(),
      debugger_isRunning: vi.fn(() => 1),
      c64_getPixelBuffer: vi.fn(() => 0),
      sid_getAudioBuffer: vi.fn(() => 0),
      sid_dumpBuffer: vi.fn(() => 2),
      sid_setSampleRate: vi.fn(),
      c64_loadPRG: vi.fn(),
      c64_insertDisk: vi.fn(),
      c64_loadCartridge: vi.fn(),
      c64_loadSnapshot: vi.fn(),
      c64_removeCartridge: vi.fn(),
      c64_ramRead: vi.fn(() => 0xab),
      c64_ramWrite: vi.fn(),
      c64_getPC: vi.fn(() => {
        const v = resolvedPcSeq[pcCallIndex % resolvedPcSeq.length];
        pcCallIndex++;
        return v;
      }),
      c64_getSnapshotSize: vi.fn(() => 4),
      malloc: vi.fn(() => 8),
      c64_getSnapshot: vi.fn((ptr: number) => {
        heapU8.set([9, 8, 7, 6], ptr);
      }),
      free: vi.fn(),
    };

    const wasm = {
      exports,
      heap: {
        heapU8,
        heapF32,
        heapU32: new Uint32Array(heapU8.buffer),
      },
      allocAndWrite: vi.fn(() => 16),
      free: vi.fn(),
      consumeCartLineCount: vi.fn(() => 1),
    } as unknown as C64WASM;

    return { wasm, exports, heapU8 };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a minimal valid CRT header with one CHIP packet.
   * EXROM=0, GAME=1 → 8K normal cartridge.
   */
  function makeCrtData(): Uint8Array {
    const buf = new Uint8Array(64 + 16 + 8192);
    const view = new DataView(buf.buffer);
    // Magic
    const magic = 'C64 CARTRIDGE   ';
    for (let i = 0; i < 16; i++) buf[i] = magic.charCodeAt(i);
    // Header length = 64
    view.setUint32(16, 64, false);
    // Version = 1
    view.setUint16(20, 1, false);
    // hwType = 0 (Normal)
    view.setUint16(22, 0, false);
    // EXROM = 0, GAME = 1
    buf[24] = 0;
    buf[25] = 1;
    // CHIP packet at offset 64
    buf[64] = 0x43; buf[65] = 0x48; buf[66] = 0x49; buf[67] = 0x50; // "CHIP"
    view.setUint32(64 + 4, 16 + 8192, false); // packet length
    view.setUint16(64 + 12, 0x8000, false);   // load address
    view.setUint16(64 + 14, 8192, false);     // ROM size
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Existing tests
  // ---------------------------------------------------------------------------

  it('loads and initializes through C64WASM.load', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);

    const emulator = await C64Emulator.load('/custom.wasm');

    expect(C64WASM.load).toHaveBeenCalledWith('/custom.wasm');
    expect(exports.c64_init).toHaveBeenCalledOnce();
    expect(emulator.ramRead(0)).toBe(0xab);
  });

  it('does not tick when paused', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    emulator.tick(12);

    expect(exports.debugger_update).not.toHaveBeenCalled();
    expect(emulator.getFrameCount()).toBe(0);
  });

  it('emits frame callback while running', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    const onFrame = vi.fn();
    emulator.onFrame = onFrame;

    emulator.start();
    emulator.tick(10);

    expect(exports.debugger_update).toHaveBeenCalledWith(10);
    expect(emulator.getFrameCount()).toBe(1);
    expect(onFrame).toHaveBeenCalledOnce();
    expect(onFrame.mock.calls[0][0].width).toBe(384);
  });

  it('provides SID audio buffer via getSidBuffer', async () => {
    const { wasm } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    const buf = emulator.getSidBuffer();
    expect(buf).toBeInstanceOf(Float32Array);
    expect(buf!.length).toBe(4096);
  });

  it('always frees allocated memory after loadGame', async () => {
    const { wasm, exports } = makeFakeWasm();
    (exports.c64_loadPRG as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad prg');
    });

    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    expect(() => emulator.loadGame({ type: 'prg', data: new Uint8Array([1, 2]) })).toThrow(
      'bad prg',
    );
    expect((wasm as any).free).toHaveBeenCalledWith(16);
  });

  it('returns a copied framebuffer in getFrameBuffer', async () => {
    const { wasm, heapU8 } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    const frame = emulator.getFrameBuffer();
    heapU8[0] = 250;

    expect(frame.data[0]).toBe(1);
    expect(frame.data.length).toBe(FRAME_BYTES);
  });

  // ---------------------------------------------------------------------------
  // New tests — init sequence
  // ---------------------------------------------------------------------------

  it('init calls debugger_set_speed(100) and debugger_play() after c64_init', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);

    await C64Emulator.load();

    expect(exports.debugger_set_speed).toHaveBeenCalledWith(100);
    expect(exports.debugger_play).toHaveBeenCalled();
    // Order: c64_init → debugger_set_speed → debugger_play
    const initOrder = (exports.c64_init as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const speedOrder = (exports.debugger_set_speed as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const playOrder = (exports.debugger_play as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(initOrder).toBeLessThan(speedOrder);
    expect(speedOrder).toBeLessThan(playOrder);
  });

  // ---------------------------------------------------------------------------
  // New tests — reset()
  // ---------------------------------------------------------------------------

  it('reset writes $37 to address 1 and calls debugger_play', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    // Clear call history from init
    (exports.c64_ramWrite as ReturnType<typeof vi.fn>).mockClear();
    (exports.debugger_play as ReturnType<typeof vi.fn>).mockClear();

    emulator.reset();

    expect(exports.c64_reset).toHaveBeenCalled();
    expect(exports.c64_ramWrite).toHaveBeenCalledWith(1, 0x37);
    expect(exports.debugger_play).toHaveBeenCalled();
    expect(emulator.getFrameCount()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // New tests — tick() dTime clamping
  // ---------------------------------------------------------------------------

  it('tick clamps dTime=0 to 20ms', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();
    emulator.start();

    emulator.tick(0);

    expect(exports.debugger_update).toHaveBeenCalledWith(20);
  });

  it('tick clamps large dTime (>25ms) to 20ms', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();
    emulator.start();

    emulator.tick(500);

    expect(exports.debugger_update).toHaveBeenCalledWith(20);
  });

  it('tick passes through dTime within normal range (1–25ms)', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();
    emulator.start();

    emulator.tick(20);

    expect(exports.debugger_update).toHaveBeenCalledWith(20);
  });

  // ---------------------------------------------------------------------------
  // New tests — removeCartridge()
  // ---------------------------------------------------------------------------

  it('removeCartridge calls c64_removeCartridge but does NOT reset', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    (exports.c64_reset as ReturnType<typeof vi.fn>).mockClear();

    emulator.removeCartridge();

    expect(exports.c64_removeCartridge).toHaveBeenCalled();
    expect(exports.c64_reset).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // New tests — CRT loading
  // ---------------------------------------------------------------------------

  it('CRT load happy path: runs pre-flight sequence and PC probe, logs OK', async () => {
    const { wasm, exports } = makeFakeWasm(); // default pcSequence = 4 distinct values
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const emulator = await C64Emulator.load();

    (exports.c64_reset as ReturnType<typeof vi.fn>).mockClear();
    (exports.debugger_play as ReturnType<typeof vi.fn>).mockClear();
    (exports.c64_ramWrite as ReturnType<typeof vi.fn>).mockClear();

    emulator.loadGame({ type: 'crt', data: makeCrtData() });

    // Pre-flight
    expect(exports.c64_removeCartridge).toHaveBeenCalled();
    expect(exports.c64_reset).toHaveBeenCalled();
    expect(exports.c64_ramWrite).toHaveBeenCalledWith(1, 0x37);
    expect(exports.debugger_play).toHaveBeenCalled();

    // PC probe: 60 debugger_update calls + 1 sid_getAudioBuffer drain
    const updateCalls = (exports.debugger_update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls.length).toBe(60);
    expect(exports.sid_getAudioBuffer).toHaveBeenCalled();

    // Success log
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('load OK'),
    );

    consoleSpy.mockRestore();
  });

  it('CRT load: zero cart lines emits warning and dispatches c64-cart-load-failed event', async () => {
    const { wasm } = makeFakeWasm();
    (wasm as any).consumeCartLineCount = vi.fn(() => 0);
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Capture dispatched events
    const events: CustomEvent[] = [];
    window.addEventListener('c64-cart-load-failed', (e) => events.push(e as CustomEvent));

    const emulator = await C64Emulator.load();
    emulator.loadGame({ type: 'crt', data: makeCrtData() });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no cartridge-type output'));
    expect(events.length).toBe(1);
    expect(events[0].detail.reason).toContain('not be recognised');

    warnSpy.mockRestore();
    window.removeEventListener('c64-cart-load-failed', (e) => events.push(e as CustomEvent));
  });

  it('CRT load: machine not running after load emits warning', async () => {
    const { wasm, exports } = makeFakeWasm();
    // init() does NOT call debugger_isRunning — the first (and only) call happens
    // inside loadGame() after c64_loadCartridge().  Return 0 to simulate the
    // machine failing to start after the cart load.
    (exports.debugger_isRunning as ReturnType<typeof vi.fn>).mockReturnValue(0);
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const emulator = await C64Emulator.load();
    emulator.loadGame({ type: 'crt', data: makeCrtData() });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('debugger_isRunning() returned 0'),
    );

    warnSpy.mockRestore();
  });

  it('CRT load: PC stuck at single address for 60 frames emits warning', async () => {
    // All PC values the same → stuck machine
    const { wasm } = makeFakeWasm({ pcSequence: [0xdead] });
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const emulator = await C64Emulator.load();
    emulator.loadGame({ type: 'crt', data: makeCrtData() });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CPU stuck at'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('0xDEAD'),
    );

    warnSpy.mockRestore();
  });

  it('CRT load: SID buffer is drained after PC probe even when machine is stuck', async () => {
    const { wasm, exports } = makeFakeWasm({ pcSequence: [0xdead] });
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const emulator = await C64Emulator.load();
    (exports.sid_getAudioBuffer as ReturnType<typeof vi.fn>).mockClear();

    emulator.loadGame({ type: 'crt', data: makeCrtData() });

    // sid_getAudioBuffer must be called at least once after the probe loop
    expect(exports.sid_getAudioBuffer).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

