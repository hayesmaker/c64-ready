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
      debugger_update: vi.fn(() => 1),
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
      c64_cpuWrite: vi.fn(),
      c64_setRegA: vi.fn(),
      c64_setRegX: vi.fn(),
      c64_setRegY: vi.fn(),
      c64_setSP: vi.fn(),
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

  it('applies VICE snapshots as best-effort RAM+CPU restore', async () => {
    const { wasm, exports } = makeFakeWasm();
    vi.spyOn(C64WASM, 'load').mockResolvedValue(wasm);
    const emulator = await C64Emulator.load();

    const data = makeViceV1SnapshotFixture();
    emulator.loadGame({ type: 'snapshot', data });

    expect(exports.c64_loadSnapshot).not.toHaveBeenCalled();
    expect(exports.c64_reset).toHaveBeenCalled();
    expect(exports.c64_ramWrite).toHaveBeenCalledWith(0, 0x11);
    expect(exports.c64_ramWrite).toHaveBeenCalledWith(0xffff, 0xee);
    expect(exports.c64_cpuWrite).toHaveBeenCalledWith(0x0000, 0xbb);
    expect(exports.c64_cpuWrite).toHaveBeenCalledWith(0x0001, 0xaa);
    expect(exports.c64_setRegA).toHaveBeenCalledWith(0x12);
    expect(exports.c64_setRegX).toHaveBeenCalledWith(0x34);
    expect(exports.c64_setRegY).toHaveBeenCalledWith(0x56);
    expect(exports.c64_setSP).toHaveBeenCalledWith(0x78);
    expect(exports.c64_setPC).toHaveBeenCalledWith(0x2345);
  });
});

function makeViceV1SnapshotFixture(): Uint8Array {
  const head = new Uint8Array(37);
  const magic = 'VICE Snapshot File\x1a';
  for (let i = 0; i < magic.length; i++) head[i] = magic.charCodeAt(i);
  head[19] = 1;
  head[20] = 1;
  const machine = 'C64SC';
  for (let i = 0; i < machine.length; i++) head[21 + i] = machine.charCodeAt(i);

  const mainCpuPayload = new Uint8Array(20);
  mainCpuPayload[4] = 0x12;
  mainCpuPayload[5] = 0x34;
  mainCpuPayload[6] = 0x56;
  mainCpuPayload[7] = 0x78;
  mainCpuPayload[8] = 0x45;
  mainCpuPayload[9] = 0x23;
  mainCpuPayload[10] = 0b10100101;

  const c64memPayload = new Uint8Array(4 + 65536);
  c64memPayload[0] = 0xaa;
  c64memPayload[1] = 0xbb;
  c64memPayload[4] = 0x11;
  c64memPayload[c64memPayload.length - 1] = 0xee;

  const mod1 = makeModule('MAINCPU', 1, 1, mainCpuPayload);
  const mod2 = makeModule('C64MEM', 0, 0, c64memPayload);

  const out = new Uint8Array(head.length + mod1.length + mod2.length);
  out.set(head, 0);
  out.set(mod1, head.length);
  out.set(mod2, head.length + mod1.length);
  return out;
}

function makeModule(name: string, major: number, minor: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(22 + payload.length);
  for (let i = 0; i < Math.min(name.length, 16); i++) out[i] = name.charCodeAt(i);
  out[16] = major;
  out[17] = minor;
  const size = 22 + payload.length;
  out[18] = size & 0xff;
  out[19] = (size >> 8) & 0xff;
  out[20] = (size >> 16) & 0xff;
  out[21] = (size >> 24) & 0xff;
  out.set(payload, 22);
  return out;
}
