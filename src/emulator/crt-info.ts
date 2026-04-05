/**
 * crt-info.ts
 *
 * Lightweight parser for the CRT cartridge file format.
 * Returns a human-readable summary line and structured metadata.
 *
 * Reference: https://vice-emu.sourceforge.io/vice_17.html#SEC380
 *
 * CRT header layout (all multi-byte fields are big-endian):
 *   0x00  16 bytes  Signature: "C64 CARTRIDGE   "
 *   0x10   4 bytes  Header length (usually 0x40)
 *   0x14   2 bytes  CRT version
 *   0x16   2 bytes  Hardware type (cart type ID)
 *   0x18   1 byte   EXROM line status
 *   0x19   1 byte   GAME  line status
 *   0x1A   6 bytes  Reserved
 *   0x20  32 bytes  Cart name (null-terminated ASCII)
 *   <headerLen>+    CHIP packets
 *
 * CHIP packet layout:
 *   0x00   4 bytes  Signature: "CHIP"
 *   0x04   4 bytes  Total packet length (including this header)
 *   0x08   2 bytes  Chip type (0=ROM, 1=RAM, 2=Flash)
 *   0x0A   2 bytes  Bank number
 *   0x0C   2 bytes  Load address
 *   0x0E   2 bytes  Data size (bytes)
 *   0x10   N bytes  Data
 */

/** Subset of well-known hardware type names (matches VICE source). */
export const CRT_HW_TYPES: Record<number, string> = {
   0: 'Normal cartridge',
   1: 'Action Replay',
   2: 'KCS Power Cartridge',
   3: 'Final Cartridge III',
   4: 'Simons BASIC',
   5: 'Ocean type 1',
   6: 'Expert Cartridge',
   7: 'Fun Play, Power Play',
   8: 'Super Games',
   9: 'Atomic Power',
  10: 'Epyx Fastload',
  11: 'Westermann Learning',
  12: 'Rex Utility',
  13: 'Final Cartridge I',
  14: 'Magic Formel',
  15: 'C64 Game System (SYSTEM 3)',
  16: 'Warp Speed',
  17: 'Dinamic',
  18: 'Zaxxon / Super Zaxxon (SEGA)',
  19: 'Magic Desk / Domark / HES Australia',
  20: 'Super Snapshot V5',
  21: 'Comal-80',
  22: 'Structured BASIC',
  23: 'Ross',
  24: 'Dela EP64',
  25: 'Dela EP7x8',
  26: 'Dela EP256',
  27: 'Rex EP256',
  28: 'Mikro Assembler',
  29: 'Final Cartridge Plus',
  30: 'Action Replay 4',
  31: 'Stardos',
  32: 'EasyFlash',
  33: 'EasyFlash Xbank',
  34: 'Capture',
  35: 'Action Replay 3',
  36: 'Retro Replay',
  37: 'MMC64',
  38: 'MMC Replay',
  39: 'IDE64',
  40: 'Super Snapshot V4',
  41: 'IEEE-488',
  42: 'Game Killer',
  43: 'Prophet64',
  44: 'EXOS',
  45: 'Freeze Frame',
  46: 'Freeze Machine',
  47: 'Snapshot64',
  48: 'Super Explode V5.0',
  49: 'Magic Voice',
  50: 'Action Replay 2',
  51: 'MACH 5',
  52: 'Diashow-Maker',
  53: 'Pagefox',
  54: 'Kingsoft',
  55: 'Silverrock 128K Longshot',
  56: 'Formel 64',
  57: 'RGCD',
  58: 'RR-Net MK3',
  59: 'Easy Calc',
  60: 'GMod2',
  61: 'MAX Basic',
  62: 'GMod3',
  63: 'ZIPP-CODE 48',
  64: 'Blackbox V8',
  65: 'Blackbox V3',
  66: 'Blackbox V4',
  67: 'REX RAM-Floppy',
  68: 'BIS-Plus',
  69: 'SD-BOX',
  70: 'MultiMAX',
  71: 'Blackbox V9',
  72: 'Lt. Kernal Host Adaptor',
  73: 'RAMLink',
  74: 'H.E.R.O.',
  75: 'IEEE Flash! 64',
  76: 'Turtle Graphics II',
  77: 'Freeze Frame MK2',
  78: 'Partner 64',
};

export interface CrtInfo {
  /** Full human-readable log line, ready to pass to console.log/error. */
  line: string;
  /** Numeric hardware type ID from the CRT header. */
  hwType: number;
  /** Human-readable hardware type name. */
  hwName: string;
  /** EXROM line value (0 or 1). */
  exrom: number;
  /** GAME line value (0 or 1). */
  game: number;
  /** Bank configuration derived from EXROM/GAME bits. */
  bankConfig: string;
  /** Cart name string from the header (may be empty). */
  cartName: string;
  /** Number of CHIP packets found. */
  chipCount: number;
  /** Total ROM data bytes across all CHIP packets. */
  totalRomBytes: number;
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return (((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0);
}

function readU16BE(buf: Uint8Array, offset: number): number {
  return (((buf[offset] << 8) | buf[offset + 1]) >>> 0);
}

/**
 * Parse a CRT file and return a human-readable summary plus structured metadata.
 *
 * @param data      Raw CRT bytes.
 * @param filename  Optional filename shown in the log prefix (e.g. "game.crt").
 * @returns         `null` if the data is too short or the magic bytes are absent.
 */
export function parseCrtInfo(data: Uint8Array, filename?: string): CrtInfo | null {
  // Need at least 0x40 bytes for the full CRT header
  if (!data || data.length < 0x40) return null;

  // Validate magic "C64 CARTRIDGE"
  const magic = String.fromCharCode(...Array.from(data.slice(0, 16)));
  if (!magic.startsWith('C64 CARTRIDGE')) return null;

  const headerLen = readU32BE(data, 0x10); // typically 0x40
  const hwType    = readU16BE(data, 0x16);
  const exrom     = data[0x18];
  const game      = data[0x19];

  // Cart name: null-terminated ASCII at 0x20, up to 32 bytes
  let cartName = '';
  for (let i = 0x20; i < 0x40 && data[i] !== 0; i++) {
    cartName += String.fromCharCode(data[i]);
  }
  cartName = cartName.trim();

  // Bank config from EXROM/GAME bits (mirrors VICE behaviour)
  //   exrom=0 game=0 → 16K (ROML+ROMH)
  //   exrom=0 game=1 → 8K  (ROML only)
  //   exrom=1 game=0 → Ultimax
  //   exrom=1 game=1 → inactive (pass-through)
  let bankConfig: string;
  if      (exrom === 0 && game === 0) bankConfig = '16K (ROML+ROMH)';
  else if (exrom === 0 && game === 1) bankConfig = '8K (ROML only)';
  else if (exrom === 1 && game === 0) bankConfig = 'Ultimax';
  else                                bankConfig = 'inactive (pass-through)';

  // Walk CHIP packets to count them and sum up actual ROM data bytes
  let chipCount    = 0;
  let totalRomBytes = 0;
  let offset = Math.max(headerLen, 0x40);

  while (offset + 16 <= data.length) {
    const chipMagic = String.fromCharCode(...Array.from(data.slice(offset, offset + 4)));
    if (chipMagic !== 'CHIP') break;

    const packetLen = readU32BE(data, offset + 4);
    if (packetLen < 16) break; // malformed packet

    const dataSize = readU16BE(data, offset + 0x0E);
    chipCount++;
    totalRomBytes += dataSize;
    offset += packetLen;
  }

  const hwName    = CRT_HW_TYPES[hwType] ?? `Unknown(${hwType})`;
  const fileLabel = filename ? ` "${filename}"` : '';
  const namePart  = cartName ? ` name="${cartName}"` : '';
  const kbActual  = (totalRomBytes / 1024).toFixed(0);

  const line =
    `[C64 cart]${fileLabel} loading: hwType=${hwType}(${hwName})` +
    ` | ${bankConfig} flags, ${kbActual}K actual` +
    ` | ${chipCount} CHIP(s) | ${data.length} bytes${namePart}`;

  return { line, hwType, hwName, exrom, game, bankConfig, cartName, chipCount, totalRomBytes };
}

