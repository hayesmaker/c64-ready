import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C64Emulator } from '../../src/emulator/c64-emulator';
import { C64WASM } from '../../src/emulator/c64-wasm';

const FRAME_BYTES = 384 * 272 * 4;

describe('C64Emulator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeFakeWasm() {
    const heapU8 = new Uint8Array(FRAME_BYTES + 64);
    for (let i = 0; i < 16; i++) {
      heapU8[i] = i + 1;
    }

    const heapF32 = new Float32Array(4096 + 32);
    heapF32[0] = 0.25;
    heapF32[1] = -0.5;

    const exports = {
      c64_init: vi.fn(),
      c64_reset: vi.fn(),
      c64_removeCartridge: vi.fn(),
      debugger_update: vi.fn(() => 1),
      debugger_isRunning: vi.fn(() => 1),
      debugger_set_speed: vi.fn(),
      debugger_play: vi.fn(),
      c64_getPC: vi.fn(() => 0x8009), // default: advancing PC (different values per call)
      c64_getPixelBuffer: vi.fn(() => 0),
      sid_getAudioBuffer: vi.fn(() => 0),
      sid_dumpBuffer: vi.fn(() => 2),
      c64_loadPRG: vi.fn(),
      c64_insertDisk: vi.fn(),
      c64_loadCartridge: vi.fn(),
      c64_loadSnapshot: vi.fn(),
      c64_ramRead: vi.fn(() => 0xab),
      c64_getSnapshotSize: vi.fn(() => 4),
      malloc: vi.fn(() => 8),
      c64_getSnapshot: vi.fn((ptr: number) => {
        heapU8.set([9, 8, 7, 6], ptr);
      }),
      free: vi.fn(),
    };
    // Make c64_getPC return a different value each call (simulating advancing PC)
    let _pcCall = 0;
    (exports.c64_getPC as ReturnType<typeof vi.fn>).mockImplementation(() => 0x8000 + (_pcCall++ * 10));

    const wasm = {
      exports,
      heap: {
        heapU8,
        heapF32,
        heapU32: new Uint32Array(heapU8.buffer),
      },
      allocAndWrite: vi.fn(() => 16),
      free: vi.fn(),
      consumeCartLineCount: vi.fn(() => 1), // default: 1 line → recognised CRT
    } as unknown as C64WASM;

    return { wasm, exports, heapU8 };
  }

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

  it('always frees allocated memory after loadGame for non-crt types', async () => {
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

  it('does NOT free the ptr after a successful crt load (WASM retains it during bank parsing)', async () => {
    const { wasm } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    emulator.loadGame({ type: 'crt', data: new Uint8Array([1, 2, 3]) });

    expect((wasm as any).free).not.toHaveBeenCalled();
  });

  it('calls removeCartridge then reset then debugger_play before loadCartridge (mirrors headless pre-flight)', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    const callOrder: string[] = [];
    (exports.c64_removeCartridge as ReturnType<typeof vi.fn>).mockImplementation(() =>
      callOrder.push('removeCartridge'),
    );
    (exports.c64_reset as ReturnType<typeof vi.fn>).mockImplementation(() =>
      callOrder.push('reset'),
    );
    (exports.debugger_play as ReturnType<typeof vi.fn>).mockImplementation(() =>
      callOrder.push('debugger_play'),
    );
    (exports.c64_loadCartridge as ReturnType<typeof vi.fn>).mockImplementation(() =>
      callOrder.push('loadCartridge'),
    );

    emulator.loadGame({ type: 'crt', data: new Uint8Array([1, 2, 3]) });

    // debugger_play is called once during init and once in the CRT pre-flight
    expect(callOrder).toContain('removeCartridge');
    expect(callOrder).toContain('reset');
    expect(callOrder).toContain('loadCartridge');
    // The pre-flight debugger_play must come between reset and loadCartridge
    const resetIdx = callOrder.indexOf('reset');
    const playIdx = callOrder.lastIndexOf('debugger_play');
    const loadIdx = callOrder.indexOf('loadCartridge');
    expect(resetIdx).toBeLessThan(playIdx);
    expect(playIdx).toBeLessThan(loadIdx);
  });

  it('reset() calls c64_reset then debugger_play so the machine resumes', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    // Clear call counts from init
    (exports.c64_reset as ReturnType<typeof vi.fn>).mockClear();
    (exports.debugger_play as ReturnType<typeof vi.fn>).mockClear();

    emulator.reset();

    expect(exports.c64_reset).toHaveBeenCalledOnce();
    expect(exports.debugger_play).toHaveBeenCalledOnce();
  });

  it('removeCartridge only calls c64_removeCartridge — no implicit reset', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    emulator.removeCartridge();

    expect(exports.c64_removeCartridge).toHaveBeenCalledOnce();
    // reset must NOT be called implicitly — callers decide if they want a reset
    expect(exports.c64_reset).not.toHaveBeenCalled();
  });

  it('warns to console when crt load produces no diagnostic output (unrecognised format)', async () => {
    const { wasm } = makeFakeWasm();
    // Simulate: WASM printed nothing → format not recognised
    (wasm as any).consumeCartLineCount = vi.fn(() => 0);
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: Event[] = [];
    window.addEventListener('c64-cart-load-failed', (e) => events.push(e));

    const emulator = await C64Emulator.load();
    emulator.loadGame({ type: 'crt', data: new Uint8Array([1, 2, 3]) });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('CRT format may not be recognised'));
    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail.reason).toMatch(/not be recognised/i);
  });

  it('warns to console when debugger_isRunning returns 0 after crt load (machine did not start)', async () => {
    const { wasm, exports } = makeFakeWasm();
    // Cart lines OK but machine not running
    (exports.debugger_isRunning as ReturnType<typeof vi.fn>).mockReturnValue(0);
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: Event[] = [];
    window.addEventListener('c64-cart-load-failed', (e) => events.push(e));

    const emulator = await C64Emulator.load();
    emulator.loadGame({ type: 'crt', data: new Uint8Array([1, 2, 3]) });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('debugger_isRunning() returned 0'));
    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail.reason).toMatch(/did not start/i);
  });

  it('warns when CPU PC does not advance after load (stuck CPU / memory banking bug)', async () => {
    const { wasm, exports } = makeFakeWasm();
    // PC always returns the same value — simulates stuck CPU
    (exports.c64_getPC as ReturnType<typeof vi.fn>).mockReturnValue(0xa47f);
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: Event[] = [];
    window.addEventListener('c64-cart-load-failed', (e) => events.push(e));

    const emulator = await C64Emulator.load();
    emulator.loadGame({ type: 'crt', data: new Uint8Array([1, 2, 3]) });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('CPU appears stuck'));
    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail.reason).toMatch(/memory banking/i);
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
});

