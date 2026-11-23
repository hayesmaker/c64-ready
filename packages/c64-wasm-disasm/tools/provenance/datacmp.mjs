// Compare data sections of two wasm files: report shared byte runs (>= MIN bytes, non-trivial).
// Usage: node datacmp.mjs a.wasm b.wasm [MIN=24]   (TOP=n limits the listing)
// Caveat: two Emscripten builds share musl/libm tables, so shared data alone proves little.
import fs from 'fs';
const [a, b, minArg] = process.argv.slice(2);
const MIN = +(minArg || 24);
function dataSegs(buf) {
  let p = 8;
  const segs = [];
  const u = () => {
    let r = 0,
      s = 0,
      x;
    do {
      x = buf[p++];
      r |= (x & 127) << s;
      s += 7;
    } while (x & 128);
    return r >>> 0;
  };
  while (p < buf.length) {
    const id = buf[p++];
    const len = u();
    const end = p + len;
    if (id === 11) {
      const n = u();
      for (let i = 0; i < n; i++) {
        const flags = u();
        if (flags !== 0) throw 'flags';
        let off = 0;
        if (buf[p++] !== 0x41) throw 'op'; // i32.const
        let r = 0,
          s = 0,
          x;
        do {
          x = buf[p++];
          r |= (x & 127) << s;
          s += 7;
        } while (x & 128);
        if (s < 32 && x & 64) r |= -1 << s;
        off = r;
        p++; // end
        const sz = u();
        segs.push({ off, bytes: buf.subarray(p, p + sz) });
        p += sz;
      }
    }
    p = end;
  }
  return segs;
}
const A = dataSegs(fs.readFileSync(a)),
  B = dataSegs(fs.readFileSync(b));
const bAll = Buffer.concat(B.map((s) => s.bytes));
const bIdx = new Map();
for (let i = 0; i + 8 <= bAll.length; i++) {
  const k = bAll.toString('latin1', i, i + 8);
  if (!bIdx.has(k)) bIdx.set(k, []);
  bIdx.get(k).push(i);
}
const distinct = (buf) => new Set(buf).size;
let total = 0;
const runs = [];
for (const s of A) {
  let i = 0;
  while (i + MIN <= s.bytes.length) {
    const k = s.bytes.toString('latin1', i, i + 8);
    let best = 0,
      bpos = -1;
    for (const j of bIdx.get(k) || []) {
      let l = 0;
      while (i + l < s.bytes.length && j + l < bAll.length && s.bytes[i + l] === bAll[j + l]) l++;
      if (l > best) {
        best = l;
        bpos = j;
      }
    }
    if (best >= MIN && distinct(s.bytes.subarray(i, i + best)) > 6) {
      runs.push({
        aOff: s.off + i,
        len: best,
        bPos: bpos,
        txt: s.bytes
          .subarray(i, i + Math.min(best, 40))
          .toString('latin1')
          .replace(/[^\x20-\x7e]/g, '.'),
      });
      total += best;
      i += best;
    } else i++;
  }
}
console.log(
  `A data ${A.reduce((t, s) => t + s.bytes.length, 0)} bytes; shared runs >= ${MIN}: ${runs.length}, ${total} bytes`,
);
for (const r of runs.sort((x, y) => y.len - x.len).slice(0, +(process.env.TOP || 60)))
  console.log(String(r.len).padStart(6), String(r.aOff).padStart(8), r.txt);
