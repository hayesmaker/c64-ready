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

    let spReg = 0;
    let xReg = 0;

    const exports = {
      c64_init: vi.fn(),
      c64_reset: vi.fn(),
      c64_step: vi.fn(() => {
        spReg = xReg;
      }),
      debugger_update: vi.fn(() => 1),
      debugger_step: vi.fn(() => {
        spReg = xReg;
      }),
      c64_getPixelBuffer: vi.fn(() => 0),
      sid_getAudioBuffer: vi.fn(() => 0),
      sid_dumpBuffer: vi.fn(() => 2),
      c64_loadPRG: vi.fn(),
      c64_insertDisk: vi.fn(),
      c64_setDriveEnabled: vi.fn(),
      c64_loadCartridge: vi.fn(),
      c64_loadSnapshot: vi.fn(),
      c64_ramRead: vi.fn(() => 0xab),
      c64_ramWrite: vi.fn(),
      c64_cpuRead: vi.fn(() => 0),
      c64_cpuWrite: vi.fn(),
      c64_setRegA: vi.fn(),
      c64_setRegX: vi.fn((v: number) => {
        xReg = v;
      }),
      c64_setRegY: vi.fn(),
      c64_setSP: vi.fn((v: number) => {
        spReg = v;
      }),
      c64_getSP: vi.fn(() => spReg),
      c64_setPC: vi.fn(),
      c64_setFlagN: vi.fn(),
      c64_setFlagV: vi.fn(),
      c64_setFlagU: vi.fn(),
      c64_setFlagB: vi.fn(),
      c64_setFlagD: vi.fn(),
      c64_setFlagI: vi.fn(),
      c64_setFlagZ: vi.fn(),
      c64_setFlagC: vi.fn(),
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

  it('loads PRG with inject mode enabled', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    emulator.loadGame({ type: 'prg', data: new Uint8Array([1, 2, 3]) });

    expect(exports.c64_loadPRG).toHaveBeenCalledWith(16, 3, 1);
  });

  it('enables drive before inserting a D64 image', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    emulator.loadGame({ type: 'd64', data: new Uint8Array([1, 2, 3, 4]) });

    expect(exports.c64_setDriveEnabled).toHaveBeenCalledWith(1);
    expect(exports.c64_insertDisk).toHaveBeenCalledWith(16, 4);
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

  it('loads native snapshots via c64_loadSnapshot', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    emulator.loadGame({ type: 'snapshot', data });

    expect(exports.c64_loadSnapshot).toHaveBeenCalledTimes(1);
    expect(exports.c64_loadSnapshot).toHaveBeenCalledWith(16, data.length);
  });

  it('preserves running state across snapshot restore', async () => {
    const { wasm } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    emulator.start();
    expect(emulator.isRunning()).toBe(true);

    emulator.loadGame({ type: 'snapshot', data: new Uint8Array([7, 8, 9]) });

    expect(emulator.isRunning()).toBe(true);
  });

  it('reboot() re-instantiates WASM and keeps running state', async () => {
    const first = makeFakeWasm();
    const second = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValueOnce(first.wasm).mockResolvedValueOnce(second.wasm);

    const emulator = await C64Emulator.load('/custom.wasm');
    emulator.start();
    emulator.tick(16);
    expect(emulator.getFrameCount()).toBe(1);

    await emulator.reboot();

    expect(C64WASM.load).toHaveBeenNthCalledWith(2, '/custom.wasm');
    expect(second.exports.c64_init).toHaveBeenCalled();
    expect(emulator.isRunning()).toBe(true);
    expect(emulator.getFrameCount()).toBe(0);

    emulator.tick(20);
    expect(second.exports.debugger_update).toHaveBeenCalledWith(20);
  });
});
