# c64-wasm-disasm: plan

A commented disassembly of `public/c64.wasm`, the C64 emulator core c64-ready runs on. The
core comes from lvllvl.com (James, `jaammees`). Its C source was never published and the
author has since died, so the binary is all we have. This package documents it, kept
separate from the emulator glue code in `src/`.

The companion investigation into where the source came from is in
[PROVENANCE.md](PROVENANCE.md).

Status: **planning**. Nothing below is built yet.

## Goals

- Every function in the core has a name, a signature and a one-line summary.
- Every important memory structure (CPU, VIC-II, CIAs, SID, PLA, 1541, cartridges, bus
  lines) has a documented layout.
- The core paths (CPU, interrupts, VIC timing, SID) carry detailed inline comments.
- Everything is reproducible from the binary and checked in CI, so the annotations can't
  silently drift from the code.
- A by-product, `c64.named.wasm`, is the same code with a WASM name section, so browser
  devtools and profilers show real function names when debugging c64-ready.

Non-goal: a line-by-line commentary of the whole 51k-line WAT. The long tail gets names and
summaries; the detail goes where it pays off.

## The binary

| Fact         | Value                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Original     | lvllvl `dist/c64/wasm/c64.wasm`, sha1 `229ab90229a1bcced7bce040ee5e60c4cb8b3e34`, 185,394 bytes                                     |
| In c64-ready | Same, plus one export (`c64_nmiLine` → func 396) added by `tools/patch-wasm-exports.mjs`. Code is unchanged.                        |
| Functions    | 607 defined + 5 imported; 130 exports; function table of 218 entries                                                                |
| Debug info   | None: no name section, no source paths                                                                                              |
| Toolchain    | Emscripten, LLVM wasm backend era (`__growWasmMemory`, `dynCall_*`, `emscripten_asm_const_iii`); exact version TBD in PROVENANCE.md |
| Data         | Commodore KERNAL, BASIC, character and 1541 DOS ROMs are embedded in the data section                                               |

### Already identified (from the RESTORE work, PR #221)

| What                                                                                                     | Where                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| C64 CPU struct                                                                                           | linear memory 82136 (`+124` SP, `+136` NMI pending, `+140` reset pending, `+92`/`+76` microcode scheduling) |
| Key state array (65 bytes, index 64 = RESTORE)                                                           | 152128                                                                                                      |
| Key → matrix (row, col) table, 8 bytes per key; RESTORE = (-1, -1)                                       | 152208                                                                                                      |
| Bus/line block: RDY (1153520), NMI line count (1153528), IRQ line count (1153532), CPU pointer (1153548) | 1153520–1153551                                                                                             |
| `cpu_nmi(cpu)`                                                                                           | func 233                                                                                                    |
| `cpu_irq(cpu)` / `cpu_irq_clear(cpu)`                                                                    | func 234 / 235                                                                                              |
| CPU interrupt-sequence microstep (vector select $FFFA/$FFFC/$FFFE)                                       | func 254                                                                                                    |
| `cpu_reset(cpu)` / CPU snapshot load                                                                     | func 232 / 207                                                                                              |
| `cpu_set_rdy(cpu, level)` (VIC BA stall)                                                                 | func 231                                                                                                    |
| `nmi_line(assert)` (ref-counted, edge on 0→1)                                                            | func 396                                                                                                    |
| `irq_line(assert)`                                                                                       | func 397                                                                                                    |
| VIC `$D019` IRQ update                                                                                   | func 180                                                                                                    |
| System block snapshot save / load                                                                        | func 374 / 375                                                                                              |
| `keyboard_keyPressed` / `keyboard_keyReleased` / matrix scan                                             | func 153 / 154 / 155–156                                                                                    |

## Package layout

```
packages/c64-wasm-disasm/
  PLAN.md            # this file
  PROVENANCE.md      # source investigation: plan, evidence log, conclusions
  README.md          # what this is, how to build, licensing note
  symbols/
    functions.json   # func index → name, signature, subsystem, summary, confidence, notes
    memory.json      # linear-memory map: structs, fields, tables
    data.json        # data segments: ROMs by reference only, tables, strings
  notes/             # prose per subsystem: cpu.md, interrupts.md, memory.md, vic.md, cia.md,
                     # sid.md, carts.md, snapshot.md, debugger.md, 1541.md, runtime.md
  tools/
    build.mjs        # c64.wasm + symbols → out/
    check.mjs        # validates symbols against the binary
    trace.mjs        # instrumented-run helper (phase 4)
  out/               # generated, git-ignored: wat/<subsystem>.wat, c64.named.wasm, decompiled
                     # pseudo-C (wasm-decompile)
```

Rules:

- **The symbol map is the source of truth.** Comments live in `symbols/*.json` and
  `notes/`, and the annotated WAT is generated from them. Never hand-edit `out/`.
- **Each entry records its confidence:** `confirmed` (verified by trace or test),
  `likely` or `guess`.
- **ROMs only by reference:** name, part number, offset, size, sha1. Never emit or commit
  ROM bytes; they are Commodore copyright.
- **Pinned tools:** wabt is a dev dependency of this package only. It stays out of the
  root `package.json`, and npm only publishes what the root `files` list names, so nothing
  here ships in the `c64-ready` package.

## Phases

### 1. Skeleton (mechanical)

- Tooling: `build.mjs` disassembles with `wasm2wat`, splits by subsystem, and injects names
  and comments.
- Name everything that can be named automatically:
  - the 130 exports and 5 imports
  - the Emscripten runtime: ctors, `stackSave`/`stackAlloc`/`stackRestore`, `dynCall_*`, `setThrew`
  - libc and malloc (`malloc`, `free`, `memcpy`, `memset`, the printf family), matched by
    signature and shape
  - function-table entries
- Call graph (who calls whom, including the `call_indirect` sites) written to
  `out/callgraph.json`.
- Data map: locate each ROM by sha1 and map the string table and lookup tables.

Expected result: about 30% of functions named.

### 2. Memory map

Recover the structs, using the exported getters as anchors, since each reads one field:
`c64_getRegA` reads 82257, for example.

- C64 CPU (6510 + port $00/$01) and the 1541 CPU
- PLA / banking state, RAM, colour RAM
- VIC-II, CIA1, CIA2, SID (registers + internal state)
- 1541: VIA1/VIA2, GCR track buffer, head position
- cartridge state (type, banks, EasyFlash flash state)
- debugger: breakpoints (PC / memory / raster), speed, run state
- the bus/line block above

### 3. Per-subsystem annotation

Done one subsystem per PR, in order of value to c64-ready:

1. **CPU core:** a microcoded, cycle-exact 6510. Covers the opcode and addressing tables,
   the per-cycle step, and how interrupts are sampled.
2. **Interrupt lines:** RDY/IRQ/NMI. RDY is mostly done already.
3. **Memory and banking:** the read/write dispatch, `readNS` (no side effects) variants
   and I/O mapping.
4. **VIC-II:** raster/cycle loop, badlines, sprites, pixel output into the frame buffer.
5. **CIAs:** timers, TOD, the keyboard/joystick ports, the interrupt control register.
6. **SID:** voices, filter, sampling into the 4096-sample audio ring. Tie this to the audio
   rules in `AGENTS.md`: why `sid_getAudioBuffer()` resets the write cursor.
7. **Cartridges:** normal 8K/16K, Ocean, EasyFlash, Magic Desk, GMod2, C64GS.
8. **Snapshots:** the format of `c64_getSnapshot`/`c64_loadSnapshot`, which matters for the
   `.c64` files the agent CLI reads.
9. **Debugger:** breakpoints, `debugger_update` timing, speed control.
10. **1541:** CPU, VIAs, GCR, disk insertion.

Each subsystem PR delivers names and summaries in `functions.json`, its struct in
`memory.json`, a prose note in `notes/`, and inline comments on its key functions.

### 4. Runtime tracing

Static reading is backed by observation. A tooling-only instrumented copy of the binary
(a counter or log call injected at each function entry) records which functions run
during a scripted scenario. The headless runner and `bin/agent.mjs` already drive
deterministic scenarios.

Example scenarios: write a SID register, trigger a raster IRQ, press a key, load each
cartridge type, insert a disk and `LOAD"$",8`, take and restore a snapshot.

A function that runs only in one scenario is identified for free. Tracing results are
recorded as `confirmed` in the symbol map.

## Verification

- `tools/check.mjs` runs in CI (vitest):
  - every named function's index and signature match the binary
  - every struct field referenced in `memory.json` is actually loaded or stored at that
    offset by some function
  - no ROM bytes appear in any committed file
- **Round trip:** the generated annotated WAT reassembles (`wat2wasm`) to a code section
  byte-identical to the original.
- **Live checks** against a running core in headless tests, for example SP read through
  the CPU struct equals `c64_getSP()`, and the NMI line count rises when CIA2 raises an NMI.

## Open decisions

Recommendations in **bold**.

1. **Commenting depth.** **Every function named and summarised, prose per subsystem,
   detailed inline comments on the core paths only.** The alternative is a full
   line-by-line commentary.
2. **Package scope.** **Docs and tooling only, never published.** Later, possibly publish
   `c64.named.wasm` as a drop-in debug build.
3. **Order.** **Run PROVENANCE.md phases B1–B3 first.** They're cheap, and finding the
   original source would make much of phases 3–4 unnecessary.
4. **Outreach.** Public sources only, or contact people (see PROVENANCE.md)? The
   maintainer decides; any contact with people who knew the author is theirs to make.

## Rough size

- Phases 1–2 and PROVENANCE B1–B3: a few focused sessions, most of the value.
- Phase 3: the long tail, one subsystem per PR.
- Phase 4: tooling plus one session per subsystem it's used on.
