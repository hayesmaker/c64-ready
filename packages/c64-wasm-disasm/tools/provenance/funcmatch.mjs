// Function-level similarity between two WAT files (wasm2wat output, flat form).
// Features per function: constants (IDF-weighted) + opcode 4-gram shingles (immediates stripped).
// For each function in A (>= 12 ops), finds the best-scoring function in B and prints a histogram.
//
// Usage: node funcmatch.mjs a.wat b.wat         histogram
//        LIST=1 node funcmatch.mjs a.wat b.wat  plus one line per function: score aN(ops) bM(ops)
// Indices are positions among defined functions; add the module's imported-function count to get
// the wasm function index (c64.wasm: +5, minimal64 m64.wasm: +2, nes.wasm: see its import section).
import fs from 'fs';
const [fa, fb] = process.argv.slice(2);
function parse(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const funcs = [];
  let cur = null;
  for (const line of txt.split('\n')) {
    const m = line.match(/^  \(func \$?(\S*)/);
    if (m) {
      cur = { idx: funcs.length, name: m[1], ops: [], consts: [] };
      funcs.push(cur);
      continue;
    }
    if (!cur || !line.startsWith('    ')) continue;
    const t = line.trim();
    if (!t || t.startsWith('(local') || t.startsWith('(param') || t.startsWith('(result')) continue;
    const op = t.split(/\s+/)[0];
    cur.ops.push(op.replace(/^(call|call_indirect)$/, 'call'));
    const c = t.replace(/\)+$/, '').match(/^([if](32|64))\.const (\S+)/);
    if (c) {
      const v = c[1] === 'i32' || c[1] === 'i64' ? BigInt(c[3]) : c[3];
      const key = `${c[1][0]}:${v}`;
      cur.consts.push(key);
    }
  }
  for (const f of funcs) {
    f.cset = new Set(f.consts);
    f.sh = new Set();
    for (let i = 0; i + 4 <= f.ops.length; i++) f.sh.add(f.ops.slice(i, i + 4).join(' '));
  }
  return funcs;
}
const A = parse(fa),
  B = parse(fb);
// IDF over both
const df = new Map();
for (const f of [...A, ...B]) for (const c of f.cset) df.set(c, (df.get(c) || 0) + 1);
const N = A.length + B.length;
const w = (c) => Math.log(N / df.get(c));
const wj = (x, y) => {
  let i = 0,
    u = 0;
  for (const c of new Set([...x, ...y])) {
    const ww = w(c);
    u += ww;
    if (x.has(c) && y.has(c)) i += ww;
  }
  return u ? i / u : 0;
};
const jac = (x, y) => {
  let i = 0;
  for (const s of x) if (y.has(s)) i++;
  const u = x.size + y.size - i;
  return u ? i / u : 0;
};
const out = [];
for (const a of A) {
  if (a.ops.length < 12) continue;
  let best = null;
  for (const b of B) {
    if (b.ops.length < 6) continue;
    const r = Math.min(a.ops.length, b.ops.length) / Math.max(a.ops.length, b.ops.length);
    if (r < 0.25) continue;
    const s = 0.5 * jac(a.sh, b.sh) + 0.5 * wj(a.cset, b.cset);
    if (!best || s > best.s) best = { b, s };
  }
  out.push({ a, best });
}
const bins = [0.8, 0.6, 0.4, 0.3, 0.2, 0];
console.log(`${fa.split('/').pop()} funcs (>=12 ops): ${out.length}`);
for (let i = 0; i < bins.length; i++) {
  const lo = bins[i],
    hi = i ? bins[i - 1] : 2;
  console.log(
    `  best score ${lo.toFixed(1)}-${hi === 2 ? '1.0' : hi.toFixed(1)}: ${out.filter((o) => o.best && o.best.s >= lo && o.best.s < hi).length}`,
  );
}
if (process.env.LIST)
  for (const o of out.sort((x, y) => (y.best?.s || 0) - (x.best?.s || 0)))
    console.log(
      o.best ? o.best.s.toFixed(2) : '-',
      `a${o.a.idx}(${o.a.ops.length})`,
      o.best ? `b${o.best.b.idx}(${o.best.b.ops.length})` : '',
    );
