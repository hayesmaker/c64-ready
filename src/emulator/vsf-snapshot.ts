export interface ViceCpuState {
  a: number;
  x: number;
  y: number;
  sp: number;
  pc: number;
  status: number;
}

export interface ViceSnapshotState {
  machine: string;
  cpuData: number;
  cpuDir: number;
  ram: Uint8Array;
  cpu: ViceCpuState;
}

interface ViceModule {
  name: string;
  major: number;
  minor: number;
  payload: Uint8Array;
}

const VICE_MAGIC = 'VICE Snapshot File\x1a';
const VICE_VERSION_MAGIC = 'VICE Version\x1a';

export function tryParseViceSnapshot(data: Uint8Array): ViceSnapshotState | null {
  if (!isViceSnapshot(data)) return null;

  const machine = readNullTerminatedAscii(data, 21, 16);
  if (!machine.startsWith('C64')) {
    throw new Error(`Unsupported VICE machine "${machine}" (expected C64*)`);
  }

  const modules = readViceModules(data);
  const mainCpu = modules.find((m) => m.name === 'MAINCPU');
  const c64mem = modules.find((m) => m.name === 'C64MEM');

  if (!mainCpu) throw new Error('VICE snapshot missing MAINCPU module');
  if (!c64mem) throw new Error('VICE snapshot missing C64MEM module');

  if (mainCpu.payload.length < 11) {
    throw new Error('VICE MAINCPU module too small');
  }
  if (c64mem.payload.length < 4 + 65536) {
    throw new Error('VICE C64MEM module too small');
  }

  const cpu: ViceCpuState = {
    a: mainCpu.payload[4],
    x: mainCpu.payload[5],
    y: mainCpu.payload[6],
    sp: mainCpu.payload[7],
    pc: readU16LE(mainCpu.payload, 8),
    status: mainCpu.payload[10],
  };

  const cpuData = c64mem.payload[0];
  const cpuDir = c64mem.payload[1];
  const ram = c64mem.payload.slice(4, 4 + 65536);

  return { machine, cpuData, cpuDir, ram, cpu };
}

export function isViceSnapshot(data: Uint8Array): boolean {
  return hasAsciiPrefix(data, VICE_MAGIC);
}

function readViceModules(data: Uint8Array): ViceModule[] {
  let offset = 37;
  if (hasAsciiAt(data, offset, VICE_VERSION_MAGIC)) {
    // V2.0+ header has extra version block:
    // 13-byte magic + 4-byte version + 4-byte svn revision.
    offset += 21;
  }

  const modules: ViceModule[] = [];

  while (offset + 22 <= data.length) {
    const rawName = data.subarray(offset, offset + 16);
    if (!hasNonZeroByte(rawName)) break;

    const name = readNullTerminatedAscii(rawName, 0, rawName.length);
    const major = data[offset + 16];
    const minor = data[offset + 17];
    const size = readU32LE(data, offset + 18);

    if (size < 22) {
      throw new Error(`Invalid VICE module size (${size}) for ${name}`);
    }

    const payloadStart = offset + 22;
    const payloadEnd = offset + size;
    if (payloadEnd > data.length) {
      throw new Error(`Truncated VICE module ${name}`);
    }

    modules.push({
      name,
      major,
      minor,
      payload: data.slice(payloadStart, payloadEnd),
    });

    offset = payloadEnd;
  }

  return modules;
}

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}

function readNullTerminatedAscii(data: Uint8Array, offset: number, length: number): string {
  const end = Math.min(offset + length, data.length);
  let out = '';
  for (let i = offset; i < end; i++) {
    const b = data[i];
    if (b === 0) break;
    out += String.fromCharCode(b);
  }
  return out;
}

function hasAsciiPrefix(data: Uint8Array, text: string): boolean {
  return hasAsciiAt(data, 0, text);
}

function hasAsciiAt(data: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > data.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (data[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function hasNonZeroByte(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) return true;
  }
  return false;
}
