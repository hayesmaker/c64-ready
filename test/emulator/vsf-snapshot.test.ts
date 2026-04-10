import { describe, expect, it } from 'vitest';
import { isViceSnapshot, tryParseViceSnapshot } from '../../src/emulator/vsf-snapshot';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function asciiPadded(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < Math.min(text.length, size); i++) out[i] = text.charCodeAt(i);
  return out;
}

function u32le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}

function moduleBlock(name: string, major: number, minor: number, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(22);
  header.set(asciiPadded(name, 16), 0);
  header[16] = major;
  header[17] = minor;
  header.set(u32le(22 + payload.length), 18);

  const out = new Uint8Array(22 + payload.length);
  out.set(header, 0);
  out.set(payload, 22);
  return out;
}

function makeViceV1Snapshot(): Uint8Array {
  const head = new Uint8Array(37);
  head.set(asciiPadded('VICE Snapshot File\x1a', 19), 0);
  head[19] = 1;
  head[20] = 1;
  head.set(asciiPadded('C64SC', 16), 21);

  const mainCpu = new Uint8Array(20);
  // CLK (DWORD) left as 0
  mainCpu[4] = 0x11; // A
  mainCpu[5] = 0x22; // X
  mainCpu[6] = 0x33; // Y
  mainCpu[7] = 0x44; // SP
  mainCpu[8] = 0x34; // PC lo
  mainCpu[9] = 0x12; // PC hi
  mainCpu[10] = 0b10110101; // N V - B D I Z C

  const c64mem = new Uint8Array(4 + 65536);
  c64mem[0] = 0xaa; // cpuData
  c64mem[1] = 0xbb; // cpuDir
  c64mem[2] = 0; // exrom
  c64mem[3] = 0; // game
  c64mem[4] = 0x10;
  c64mem[4 + 0x1234] = 0x77;
  c64mem[c64mem.length - 1] = 0xee;

  const m1 = moduleBlock('MAINCPU', 1, 1, mainCpu);
  const m2 = moduleBlock('C64MEM', 0, 0, c64mem);

  const out = new Uint8Array(head.length + m1.length + m2.length);
  let off = 0;
  out.set(head, off);
  off += head.length;
  out.set(m1, off);
  off += m1.length;
  out.set(m2, off);
  return out;
}

describe('vsf-snapshot', () => {
  it('recognizes VICE snapshot magic', () => {
    const data = makeViceV1Snapshot();
    expect(isViceSnapshot(data)).toBe(true);
    expect(isViceSnapshot(new Uint8Array([0x6c, 0x76, 0x6c, 0x00]))).toBe(false);
  });

  it('parses MAINCPU and C64MEM modules', () => {
    const parsed = tryParseViceSnapshot(makeViceV1Snapshot());
    expect(parsed).toBeTruthy();
    expect(parsed!.machine).toBe('C64SC');
    expect(parsed!.cpuData).toBe(0xaa);
    expect(parsed!.cpuDir).toBe(0xbb);
    expect(parsed!.cpu.a).toBe(0x11);
    expect(parsed!.cpu.x).toBe(0x22);
    expect(parsed!.cpu.y).toBe(0x33);
    expect(parsed!.cpu.sp).toBe(0x44);
    expect(parsed!.cpu.pc).toBe(0x1234);
    expect(parsed!.cpu.status).toBe(0b10110101);
    expect(parsed!.ram[0]).toBe(0x10);
    expect(parsed!.ram[0x1234]).toBe(0x77);
    expect(parsed!.ram[0xffff]).toBe(0xee);
    expect(parsed!.debug.ramOffset).toBe(4);
    expect(parsed!.debug.trailingBytes).toBe(0);
    expect(parsed!.debug.mainCpuVersion).toBe('1.1');
    expect(parsed!.debug.c64memVersion).toBe('0.0');
  });

  it('parses real VICE 2.4 snapshot C64MEM layout', () => {
    const file = resolve(process.cwd(), 'temp/snapshots/VICE2-4%APOLLO18.vsf');
    if (!existsSync(file)) return;
    const parsed = tryParseViceSnapshot(new Uint8Array(readFileSync(file)));
    expect(parsed).toBeTruthy();
    expect(parsed!.debug.c64memPayloadLength).toBe(65543);
    expect(parsed!.debug.ramOffset).toBe(4);
    expect(parsed!.debug.trailingBytes).toBe(3);
    expect(parsed!.ram.length).toBe(65536);
  });

  it('parses real VICE 3.10 snapshot C64MEM layout', () => {
    const file = resolve(process.cwd(), 'temp/snapshots/VICE3.10%ELEVATOR.vsf');
    if (!existsSync(file)) return;
    const parsed = tryParseViceSnapshot(new Uint8Array(readFileSync(file)));
    expect(parsed).toBeTruthy();
    expect(parsed!.debug.c64memPayloadLength).toBe(65555);
    expect(parsed!.debug.ramOffset).toBe(4);
    expect(parsed!.debug.trailingBytes).toBe(15);
    expect(parsed!.ram.length).toBe(65536);
  });
});
