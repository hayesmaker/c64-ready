#!/usr/bin/env node
/**
 * patch-wasm-exports.mjs — expose internal functions of the lvllvl c64.wasm core.
 *
 * The shipped core (lvllvl, no public C source) emulates the C64's NMI line but
 * never exports it, so the RESTORE key cannot be triggered. This tool appends
 * entries to the WASM export section; no code is changed.
 *
 *   c64_nmiLine(assert: i32)  → internal func 396
 *     The wired-OR NMI line shared with CIA2: a reference count of active sources
 *     (linear memory 1153528) that calls cpu_nmi() on the 0→1 edge only.
 *     RESTORE = c64_nmiLine(1); c64_nmiLine(0)  (the 556 one-shot pulse).
 *
 * Usage: node tools/patch-wasm-exports.mjs [in.wasm] [out.wasm]
 *        (defaults: public/c64.wasm in place). Idempotent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Exports to add. `params`/`results` guard against patching a different build. */
export const EXTRA_EXPORTS = [{ name: 'c64_nmiLine', func: 396, params: ['i32'], results: [] }];

const VALTYPES = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64' };

function readLeb(buf, pos) {
  let result = 0;
  let shift = 0;
  let byte;
  do {
    byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [result >>> 0, pos];
}

function leb(n) {
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return out;
}

function readSections(bin) {
  if (bin.readUInt32LE(0) !== 0x6d736100) throw new Error('not a WASM binary');
  const sections = [];
  let pos = 8;
  while (pos < bin.length) {
    const id = bin[pos];
    const [size, start] = readLeb(bin, pos + 1);
    sections.push({ id, start: pos, bodyStart: start, end: start + size });
    pos = start + size;
  }
  return sections;
}

/** Resolve the (params, results) signature of an absolute function index. */
function funcSignature(bin, sections, funcIndex) {
  const body = (id) => {
    const s = sections.find((x) => x.id === id);
    return s ? bin.subarray(s.bodyStart, s.end) : null;
  };
  const types = [];
  const typeSec = body(1);
  let [count, p] = readLeb(typeSec, 0);
  for (let i = 0; i < count; i++) {
    p++; // 0x60 func form
    const params = [];
    const results = [];
    let n;
    [n, p] = readLeb(typeSec, p);
    for (let j = 0; j < n; j++) params.push(VALTYPES[typeSec[p++]]);
    [n, p] = readLeb(typeSec, p);
    for (let j = 0; j < n; j++) results.push(VALTYPES[typeSec[p++]]);
    types.push({ params, results });
  }
  // Count imported functions — they come first in the function index space.
  let importedFuncs = 0;
  const importSec = body(2);
  if (importSec) {
    [count, p] = readLeb(importSec, 0);
    for (let i = 0; i < count; i++) {
      let len;
      [len, p] = readLeb(importSec, p);
      p += len;
      [len, p] = readLeb(importSec, p);
      p += len;
      const kind = importSec[p++];
      if (kind === 0) {
        [, p] = readLeb(importSec, p);
        importedFuncs++;
      } else if (kind === 1) {
        p++; // elem type
        const flags = importSec[p++];
        [, p] = readLeb(importSec, p);
        if (flags & 1) [, p] = readLeb(importSec, p);
      } else if (kind === 2) {
        const flags = importSec[p++];
        [, p] = readLeb(importSec, p);
        if (flags & 1) [, p] = readLeb(importSec, p);
      } else if (kind === 3) {
        p += 2;
      } else throw new Error(`unknown import kind ${kind}`);
    }
  }
  const funcSec = body(3);
  [count, p] = readLeb(funcSec, 0);
  const local = funcIndex - importedFuncs;
  if (local < 0 || local >= count) throw new Error(`function ${funcIndex} out of range`);
  let typeIdx;
  for (let i = 0; i <= local; i++) [typeIdx, p] = readLeb(funcSec, p);
  return types[typeIdx];
}

function existingExportNames(bin, exportSec) {
  const body = bin.subarray(exportSec.bodyStart, exportSec.end);
  let [count, p] = readLeb(body, 0);
  const names = new Set();
  for (let i = 0; i < count; i++) {
    let len;
    [len, p] = readLeb(body, p);
    names.add(body.subarray(p, p + len).toString('utf8'));
    p += len + 1; // name + kind
    [, p] = readLeb(body, p);
  }
  return names;
}

/** Returns { bin, added } — `added` lists the export names newly appended. */
export function patchWasm(input, extra = EXTRA_EXPORTS) {
  const bin = Buffer.from(input);
  const sections = readSections(bin);
  const exportSec = sections.find((s) => s.id === 7);
  if (!exportSec) throw new Error('no export section');
  const have = existingExportNames(bin, exportSec);
  const todo = extra.filter((e) => !have.has(e.name));
  if (!todo.length) return { bin, added: [] };

  for (const e of todo) {
    const sig = funcSignature(bin, sections, e.func);
    const ok = sig.params.join() === e.params.join() && sig.results.join() === e.results.join();
    if (!ok) {
      throw new Error(
        `${e.name}: func ${e.func} has signature (${sig.params}) -> (${sig.results}), ` +
          `expected (${e.params}) -> (${e.results}). Unknown c64.wasm build — refusing to patch.`,
      );
    }
  }

  const body = bin.subarray(exportSec.bodyStart, exportSec.end);
  const [count, entriesStart] = readLeb(body, 0);
  const entries = todo.flatMap((e) => [
    ...leb(Buffer.byteLength(e.name)),
    ...Buffer.from(e.name),
    0x00, // func export
    ...leb(e.func),
  ]);
  const newBody = Buffer.concat([
    Buffer.from(leb(count + todo.length)),
    body.subarray(entriesStart),
    Buffer.from(entries),
  ]);
  const out = Buffer.concat([
    bin.subarray(0, exportSec.start),
    Buffer.from([7, ...leb(newBody.length)]),
    newBody,
    bin.subarray(exportSec.end),
  ]);
  return { bin: out, added: todo.map((e) => e.name) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const inPath = path.resolve(process.argv[2] ?? path.join(ROOT, 'public/c64.wasm'));
  const outPath = path.resolve(process.argv[3] ?? inPath);
  const { bin, added } = patchWasm(fs.readFileSync(inPath));
  await WebAssembly.compile(bin); // validate before writing
  fs.writeFileSync(outPath, bin);
  console.log(added.length ? `added exports: ${added.join(', ')} → ${outPath}` : 'already patched');
}
