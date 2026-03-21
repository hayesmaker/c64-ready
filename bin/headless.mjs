#!/usr/bin/env node
/*
  Minimal headless CLI for running the C64 emulator in Node.
  Usage: c64-headless [--wasm <path>] [--game <path>] [--frames <n>] [--verify]

  Defaults:
   - wasm: public/c64.wasm if present, otherwise require --wasm
   - game: public/games/cartridges/legend-of-wilf.crt if present
*/
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  console.log(`Usage: c64-headless [--wasm <path>] [--game <path>] [--frames <n>] [--verify]`);
}

// Simple arg parsing
const args = process.argv.slice(2);
let wasmArg = null;
let gameArg = null;
let frames = 300; // default run frames
let verify = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--wasm' || a === '-w') {
    wasmArg = args[++i];
  } else if (a === '--game' || a === '-g') {
    gameArg = args[++i];
  } else if (a === '--frames' || a === '-n') {
    frames = Number(args[++i]);
  } else if (a === '--verify') {
    verify = true;
  } else if (a === '--help' || a === '-h') {
    usage();
    process.exit(0);
  } else {
    console.error('Unknown arg', a);
    usage();
    process.exit(2);
  }
}

// Find sensible defaults relative to project root (assume script in repo)
const repoRoot = path.resolve(__dirname, '..');
const defaultWasmPaths = [
  path.join(repoRoot, 'public', 'c64.wasm'),
  path.join(repoRoot, 'c64.wasm'),
  path.join(repoRoot, 'src', 'emulator', 'c64.wasm'),
];
const defaultGamePaths = [
  path.join(repoRoot, 'public', 'games', 'cartridges', 'legend-of-wilf.crt'),
  path.join(repoRoot, 'games', 'cartridges', 'legend-of-wilf.crt'),
];

async function findFirstExisting(paths) {
  for (const p of paths) {
    try {
      await fs.access(p);
      return p;
    } catch (_) {}
  }
  return null;
}

(async function main() {
  try {
    let wasmPath = wasmArg;
    if (!wasmPath) {
      const found = await findFirstExisting(defaultWasmPaths);
      if (found) wasmPath = found;
    }

    if (!wasmPath) {
      console.error('No wasm found. Provide --wasm <path>');
      process.exit(1);
    }

    let gamePath = gameArg;
    if (!gamePath) {
      const found = await findFirstExisting(defaultGamePaths);
      if (found) gamePath = found;
    }

    console.log(`Starting headless C64 using WASM: ${wasmPath}` + (gamePath ? ` game: ${gamePath}` : ''));

    // Load wasm and CRT into memory and instantiate the emulator class from source
    // We reuse the project's C64Headless class by importing the built TS (via src)
    // Node ESM can import TS only if compiled; instead import JS via ts-node is complex.
    // We'll implement a minimal loader that mirrors C64WASM.load + basic loop.

    // Read wasm binary
    const wasmBinary = await fs.readFile(wasmPath);

    // Dynamically import the wasm wrapper from project source
    // The C64WASM class is implemented in src/emulator/c64-wasm.ts — import transpiled JS at dist if present
    let C64WASMModule = null;
    try {
      // Prefer importing built JS in dist if exists
      C64WASMModule = await import(pathToFileURL(path.join(repoRoot, 'dist', 'src', 'emulator', 'c64-wasm.js')).href);
    } catch (_) {
      try {
        // Fallback: import TypeScript source via ts-node/register is not available; instead import the JS runtime wrapper in src compiled by vite isn't present.
        // We'll implement a tiny instantiation inline similar to C64WASM.
        C64WASMModule = null;
      } catch (_) {
        C64WASMModule = null;
      }
    }

    // Provide minimal imports similar to src/emulator/c64-wasm.ts
    const importObject = {
      env: {
        memory: new WebAssembly.Memory({ initial: 256 }),
        table: new WebAssembly.Table({ initial: 512, maximum: 512, element: 'anyfunc' }),
        emscripten_get_sbrk_ptr: () => 5583504,
        emscripten_resize_heap: () => 0,
        emscripten_memcpy_big: (d, s, n) => d,
        setTempRet0: () => {},
        emscripten_asm_const_iii: () => 0,
      },
      wasi_snapshot_preview1: {
        fd_write: (fd, iovs, iovs_len, nwritten) => {
          try {
            const mem = importObject.env.memory;
            const view = new DataView(mem.buffer);
            const u8 = new Uint8Array(mem.buffer);
            let written = 0;
            for (let i = 0; i < iovs_len; i++) {
              const ptr = view.getUint32(iovs + i * 8, true);
              const len = view.getUint32(iovs + i * 8 + 4, true);
              if (fd === 2) {
                const text = new TextDecoder().decode(u8.subarray(ptr, ptr + len));
                console.error(text);
              }
              written += len;
            }
            view.setUint32(nwritten, written, true);
          } catch (e) {}
          return 0;
        },
      },
    };

    // Instantiate the WASM using our importObject
    const res = await WebAssembly.instantiate(wasmBinary, importObject);
    const wasmInstance = res.instance;

    // Helper to call exported functions safely
    const exports = wasmInstance.exports;

    function callExport(name, ...args) {
      const fn = exports[name];
      if (typeof fn !== 'function') throw new Error(`Export ${name} not available`);
      return fn(...args);
    }

    // Initialise Emscripten heap pointer (DYNAMICTOP_PTR) so malloc/free work.
    // These constants mirror those used in src/emulator/c64-wasm.ts
    const DYNAMICTOP_PTR = 5583504;
    const DYNAMIC_BASE = 10826544;
    try {
      const mem = importObject.env.memory || exports.memory;
      if (mem && mem.buffer) {
        new DataView(mem.buffer).setUint32(DYNAMICTOP_PTR, DYNAMIC_BASE, true);
      }
    } catch (e) {
      // ignore if we can't set it — malloc may still fail
    }

    // Call constructors and init
    if (exports.__wasm_call_ctors) try { callExport('__wasm_call_ctors'); } catch (e) {}
    if (exports.c64_init) try { callExport('c64_init'); } catch (e) {}

    // If a game was provided, load it
    if (gamePath) {
      try {
        const gameData = await fs.readFile(gamePath);
        // allocate via malloc
        if (exports.malloc && exports.free && exports.c64_loadCartridge) {
          const len = gameData.length;
          const ptr = callExport('malloc', len);
          // determine memory buffer (prefer importObject.env.memory)
          const mem = (importObject && importObject.env && importObject.env.memory) || exports.memory;
          if (!mem || !mem.buffer) throw new Error('WASM memory not available');
          const memU8 = new Uint8Array(mem.buffer);
          memU8.set(new Uint8Array(gameData), ptr);
          callExport('c64_loadCartridge', ptr, len);
          callExport('free', ptr);
        } else {
          console.warn('WASM exports do not include malloc/c64_loadCartridge — skipping game load');
        }
      } catch (e) {
        console.error('Failed to load game', e);
      }
    }

    // Start emulation loop
    if (exports.c64_init) callExport('c64_init');
    if (exports.debugger_play) try { callExport('debugger_play'); } catch (e) {}

    let frameCount = 0;
    const startTime = Date.now();
    const targetFrames = frames > 0 ? frames : Infinity;

    // Tick loop: call debugger_update and optionally print heartbeats
    while (frameCount < targetFrames) {
      if (exports.debugger_update) callExport('debugger_update', 0);
      frameCount++;
      if (verify && frameCount % 60 === 0) {
        const cycleCount = exports.c64_getCycleCount ? callExport('c64_getCycleCount') : null;
        console.log(JSON.stringify({ pid: process.pid, frame: frameCount, cycles: cycleCount }));
      } else if (frameCount % 120 === 0) {
        console.log(`HEADLESS: frame=${frameCount}`);
      }
      // Yield to event loop
      await new Promise((r) => setImmediate(r));
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Run complete. frames=${frameCount} elapsed=${elapsed.toFixed(2)}s`);
    process.exit(0);
  } catch (err) {
    console.error('Headless error', err);
    process.exit(1);
  }
})();

