import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C64Emulator } from './c64-emulator';
import { C64WASM } from './c64-wasm';

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

    const heapF32 = new Float32Array(32);
    heapF32[0] = 0.25;
    heapF32[1] = -0.5;

    const exports = {
      c64_init: vi.fn(),
      c64_reset: vi.fn(),
      debugger_update: vi.fn(),
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

    const wasm = {
      exports,
      heap: {
        heapU8,
        heapF32,
        heapU32: new Uint32Array(heapU8.buffer),
      },
      allocAndWrite: vi.fn(() => 16),
      free: vi.fn(),
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

  it('emits frame and audio callbacks while running', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    const onFrame = vi.fn();
    const onAudio = vi.fn();
    emulator.onFrame = onFrame;
    emulator.onAudio = onAudio;

    emulator.start();
    emulator.tick(10);

    expect(exports.debugger_update).toHaveBeenCalledWith(10);
    expect(emulator.getFrameCount()).toBe(1);
    expect(onFrame).toHaveBeenCalledOnce();
    expect(onFrame.mock.calls[0][0].width).toBe(384);
    expect(onAudio).toHaveBeenCalledOnce();
    expect(onAudio.mock.calls[0][0].samples.length).toBe(2);
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
});
