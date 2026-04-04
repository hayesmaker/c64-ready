#!/usr/bin/env node
/**
 * cart-diagnostics.mjs
 *
 * Batch-tests a directory of .crt cartridge files against the WASM emulator
 * and reports the result, cartridge characteristics, and failure mode for each.
 *
 * Usage:
 *   node tools/cart-diagnostics.mjs [options]
 *
 * Options:
 *   --dir  <path>   Directory of .crt files to scan (default: public/games/cartridges/8K)
 *   --wasm <path>   Path to c64.wasm (default: public/c64.wasm)
 *   --verbose       Print per-cart detail lines as they are processed
 *   --json          Output full results as JSON instead of human-readable text
 *   --help          Show this help
 *
 * Results:
 *   [OK]          Cart loaded and CPU is advancing (≥2 unique PCs over 60 frames)
 *   [STUCK]       Cart recognised but CPU is frozen at a single address
 *   [NO-OUTPUT]   WASM printed nothing during load — format not recognised
 *   [NOT-RUNNING] debugger_isRunning() returned 0 after load
 *   [CRASH]       WASM threw a RuntimeError during load
 */

import { C64WASM } from '../src/headless/c64-wasm.mjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ── CLI argument parsing ──────────────────────────────────────────────────────
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const argv = process.argv.slice(2);

let dirArg   = null;
let wasmArg  = null;
let verbose  = false;
let jsonOut  = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if      (a === '--dir'  || a === '-d') dirArg  = argv[++i];
  else if (a === '--wasm' || a === '-w') wasmArg = argv[++i];
  else if (a === '--verbose')            verbose = true;
  else if (a === '--json')               jsonOut = true;
  else if (a === '--help' || a === '-h') {
    console.log(`Usage: node tools/cart-diagnostics.mjs [--dir <path>] [--wasm <path>] [--verbose] [--json]`);
    process.exit(0);
  }
}

const cartDir  = dirArg  ? path.resolve(dirArg)  : path.join(repoRoot, 'public/games/cartridges/8K');
const wasmPath = wasmArg ? path.resolve(wasmArg) : path.join(repoRoot, 'public/c64.wasm');

// ── CRT header parser ─────────────────────────────────────────────────────────
/** Parse the CRT file header and CHIP packets to extract cart characteristics. */
function parseCrt(buf) {
  const magic = buf.slice(0, 16).toString('ascii').trimEnd();
  const headerLen = buf.readUInt32BE(16);
  const version   = buf.readUInt16BE(20);
  const hwType    = buf.readUInt16BE(22);
  const exrom     = buf[24];
  const game      = buf[25];
  const cartName  = buf.slice(32, 64).toString('ascii').replace(/\0/g, '').trim();

  const hwTypeNames = {
    0: 'Normal', 1: 'Action Replay', 3: 'Final Cartridge III', 4: 'Simons BASIC',
    5: 'Ocean type 1', 7: 'Fun Play', 8: 'Super Games', 15: 'Magic Desk',
    17: 'Dinamic', 19: 'EasyFlash', 21: 'Comal-80', 32: 'Pagefox',
  };

  // Memory map description from EXROM/GAME lines
  const memMapNames = {
    '0,0': '16K (ROML+ROMH)',
    '0,1': '8K (ROML only)',
    '1,0': 'MAX Machine (2K at $F800)',
    '1,1': 'Ultimax / disabled',
  };
  const memMap = memMapNames[`${exrom},${game}`] ?? `EXROM=${exrom} GAME=${game}`;

  const chips = [];
  let offset = headerLen;
  while (offset + 16 <= buf.length) {
    const sig = buf.slice(offset, offset + 4).toString('ascii');
    if (sig !== 'CHIP') break;
    const pktLen  = buf.readUInt32BE(offset + 4);
    const chipType = buf.readUInt16BE(offset + 8);
    const bank    = buf.readUInt16BE(offset + 10);
    const loadAddr = buf.readUInt16BE(offset + 12);
    const romSize = buf.readUInt16BE(offset + 14);
    chips.push({ bank, chipType, loadAddr: '0x' + loadAddr.toString(16).toUpperCase(), romSize });
    offset += pktLen;
    if (chips.length > 64) break; // safety cap
  }

  return { magic, version, hwType, hwTypeName: hwTypeNames[hwType] ?? `Unknown(${hwType})`, exrom, game, memMap, cartName, chips, fileSize: buf.length };
}

// ── HW type result label ──────────────────────────────────────────────────────
const RESULT = { OK: 'OK', STUCK: 'STUCK', NO_OUTPUT: 'NO-OUTPUT', NOT_RUNNING: 'NOT-RUNNING', CRASH: 'CRASH' };

// ── Load wasm binary once ─────────────────────────────────────────────────────
let wasmBuf;
try {
  wasmBuf = await fs.readFile(wasmPath);
} catch (e) {
  console.error(`Cannot read WASM at ${wasmPath}: ${e.message}`);
  process.exit(1);
}

// ── Discover carts ────────────────────────────────────────────────────────────
let files;
try {
  files = (await fs.readdir(cartDir)).filter(f => f.endsWith('.crt')).sort();
} catch (e) {
  console.error(`Cannot read cart directory ${cartDir}: ${e.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`No .crt files found in ${cartDir}`);
  process.exit(1);
}

if (!jsonOut) {
  console.error(`Scanning ${files.length} cart(s) in ${cartDir}`);
  console.error(`WASM: ${wasmPath}\n`);
}

// ── Per-cart probe ────────────────────────────────────────────────────────────
const records = [];

for (const file of files) {
  const cartPath = path.join(cartDir, file);
  let cartBuf;
  try { cartBuf = await fs.readFile(cartPath); }
  catch (e) { records.push({ file, result: RESULT.CRASH, error: e.message }); continue; }

  const info = parseCrt(cartBuf);

  // Fresh WASM instance per cart — avoids state bleed from broken carts
  const wasmAb = wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength);
  const w = new C64WASM();
  await w.instantiate(wasmAb);
  const x = w.exports;
  x.c64_init();
  x.debugger_set_speed(100);
  x.debugger_play();
  x.sid_setSampleRate(44100);

  let result, stuckPc = null, uniquePCs = null, wasmLabel = null, error = null;

  try {
    const ptr = w.allocAndWrite(new Uint8Array(cartBuf));
    x.c64_loadCartridge(ptr, cartBuf.length);

    // Collect any stdout diagnostic lines the WASM printed during load
    const cartLines = w.consumeCartLineCount();
    if (cartLines === 0) {
      result = RESULT.NO_OUTPUT;
    } else if (!x.debugger_isRunning()) {
      result = RESULT.NOT_RUNNING;
    } else {
      // 60-frame unique-PC probe
      const pcSet = new Set();
      for (let i = 0; i < 60; i++) { x.debugger_update(20); pcSet.add(x.c64_getPC()); }
      uniquePCs = pcSet.size;
      if (pcSet.size === 1) {
        result  = RESULT.STUCK;
        stuckPc = '0x' + [...pcSet][0].toString(16).toUpperCase();
      } else {
        result = RESULT.OK;
      }
    }
  } catch (e) {
    result = RESULT.CRASH;
    error  = e.message;
  }

  const record = { file, result, ...info, stuckPc, uniquePCs, error };
  records.push(record);

  if (verbose && !jsonOut) {
    const tag   = result.padEnd(11);
    const chips = `${info.chips.length} CHIP(s)`;
    const map   = info.memMap;
    const pc    = stuckPc ? ` stuck@${stuckPc}` : (uniquePCs ? ` ${uniquePCs} unique PCs` : '');
    const err   = error ? ` ERR: ${error}` : '';
    console.log(`[${tag}] ${file.padEnd(50)} | hwType=${info.hwType}(${info.hwTypeName}) | ${map} | ${chips}${pc}${err}`);
  }
}

// ── Output ────────────────────────────────────────────────────────────────────
if (jsonOut) {
  console.log(JSON.stringify(records, null, 2));
  process.exit(0);
}

// Group by result
const byResult = {};
for (const r of records) {
  (byResult[r.result] ??= []).push(r);
}

const order = [RESULT.OK, RESULT.STUCK, RESULT.CRASH, RESULT.NO_OUTPUT, RESULT.NOT_RUNNING];

for (const key of order) {
  const group = byResult[key] ?? [];
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`${key} (${group.length})`);
  console.log('─'.repeat(72));

  for (const r of group) {
    const name  = r.cartName || r.file.replace(/\.crt$/i, '');
    const chips = r.chips?.length ?? '?';
    const map   = r.memMap ?? `EXROM=${r.exrom} GAME=${r.game}`;
    const hw    = `hwType=${r.hwType}(${r.hwTypeName ?? '?'})`;

    let detail = `${hw} | ${map} | ${chips} CHIP(s) | ${r.fileSize} bytes`;
    if (r.result === RESULT.STUCK)       detail += ` | stuck @ ${r.stuckPc}`;
    if (r.result === RESULT.OK)          detail += ` | ${r.uniquePCs} unique PCs/60f`;
    if (r.result === RESULT.CRASH)       detail += ` | ${r.error}`;

    console.log(`  ${r.result.padEnd(11)} ${name}`);
    console.log(`             ${detail}`);
    console.log(`             File: ${r.file}`);
  }
}

// Summary line
const counts = order.map(k => `${k}=${(byResult[k] ?? []).length}`).join('  ');
console.log(`\n${'═'.repeat(72)}`);
console.log(`SUMMARY  ${files.length} carts   ${counts}`);
console.log('═'.repeat(72));

