import { C64WASM } from '../src/headless/c64-wasm.mjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const wasmBuf = await fs.readFile(path.join(repoRoot, 'public/c64.wasm'));
const dir = path.join(repoRoot, 'public/games/cartridges/8K');
const files = (await fs.readdir(dir)).filter(f => f.endsWith('.crt')).sort();

const results = { ok: [], stuck: [], crash: [], noOutput: [], notRunning: [] };

for (const file of files) {
  const wasmAb = wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength);
  const w = new C64WASM();
  await w.instantiate(wasmAb);
  const x = w.exports;
  x.c64_init(); x.debugger_set_speed(100); x.debugger_play(); x.sid_setSampleRate(44100);

  const cartBuf = await fs.readFile(path.join(dir, file));
  try {
    const p = w.allocAndWrite(new Uint8Array(cartBuf));
    x.c64_loadCartridge(p, cartBuf.length);
    const cartLines = w.consumeCartLineCount();
    if (cartLines === 0) { results.noOutput.push(file); continue; }
    if (!x.debugger_isRunning()) { results.notRunning.push(file); continue; }
    const pcSet = new Set();
    for (let i = 0; i < 60; i++) { x.debugger_update(20); pcSet.add(x.c64_getPC()); }
    if (pcSet.size === 1) {
      results.stuck.push({ file, pc: '0x' + [...pcSet][0].toString(16).toUpperCase() });
    } else {
      results.ok.push({ file, uniquePCs: pcSet.size });
    }
  } catch (e) {
    results.crash.push({ file, err: e.message });
  }
}

console.log('\n=== RESULTS ===');
console.log(`OK (${results.ok.length}):`);
for (const r of results.ok) console.log(`  [OK]    ${r.file} (${r.uniquePCs} unique PCs)`);
console.log(`\nSTUCK (${results.stuck.length}):`);
for (const r of results.stuck) console.log(`  [STUCK] ${r.file} @ ${r.pc}`);
console.log(`\nCRASH (${results.crash.length}):`);
for (const r of results.crash) console.log(`  [CRASH] ${r.file}: ${r.err}`);
console.log(`\nNO OUTPUT (${results.noOutput.length}):`);
for (const f of results.noOutput) console.log(`  [NO-OUTPUT] ${f}`);
console.log(`\nNOT RUNNING (${results.notRunning.length}):`);
for (const f of results.notRunning) console.log(`  [NOT-RUNNING] ${f}`);
console.log(`\nSummary: ok=${results.ok.length} stuck=${results.stuck.length} crash=${results.crash.length} noOutput=${results.noOutput.length} notRunning=${results.notRunning.length}`);

