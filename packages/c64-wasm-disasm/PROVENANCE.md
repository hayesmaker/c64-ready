# Where did c64.wasm come from?

An investigation into the origin of the source code behind `public/c64.wasm`. The binary
came from lvllvl.com, published on GitHub as `jaammees/lvllvl`. Its C source was never
published under that name, and the author has since died.

Status: **B1–B3 done (2026-11-23).** Questions 1 and 2 have a well-supported answer.
Question 3 is partly answered. B4 and B5 are still open.

## Summary

- **Toolchain:** c64.wasm was built with **Emscripten 1.39.7** (released 2020-02-03). So it
  was built between February 2020 and January 2021, when the earliest archived copy
  appears.
- **Author and language:** the lvllvl author wrote it in C. In 2022 the same author
  published a **reduced version of the same code base** as
  [`nopsta/minimal64`](https://github.com/nopsta/minimal64), under the GitHub account
  `nopsta`. It is GPL-2.0.
- **Upstream lineage:** minimal64's own file headers say the code is based on JSIDPlay2
  (Java), SIDPLAY2/libsidplay2, VICE and reSID. All of these are GPL. By that account,
  c64.wasm is a C port and reworking of GPL emulator code, not an independent design.
- **The NES core:** `nes.wasm` shares c64.wasm's 6502 core and event scheduler, so it
  comes from the same code base.
- **What the public source lacks:** the parts of c64.wasm that minimal64 leaves out have
  no public source yet: the 1541 drive, EasyFlash, GMod2, the debugger and breakpoints,
  snapshots, the mouse, and use of the real ROMs.

## Questions

1. Was the core written by the lvllvl author, derived from an existing emulator, or a mix?
   **Answer:** a mix. The lvllvl author wrote it in C, porting parts of
   JSIDPlay2/libsidplay2/VICE/reSID (F9–F14).
2. If it was derived, from which project and under what license? This determines what
   c64-ready may do with the binary and with this disassembly. **Answer:** the projects
   above, all GPL, and the author's own public release of the code is GPL-2.0. See
   [Licensing implications](#licensing-implications).
3. Does the source survive anywhere? **Partly:** minimal64 is a public subset. Whether the
   full source survives is still unknown (B4, B5).

## Findings

| #   | Finding                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The binary is unchanged since at least 2021-01-02.        | `mwenge/llamaSource` (a site copy, repo created 2021-01-02) has `lvllvl.com/js/c64/wasm/c64.wasm`, byte-identical to ours: sha1 `229ab902…`. The GitHub upload `jaammees/lvllvl` is a single "initial upload" commit on 2023-11-08.                                                                                                                                         |
| F2  | The C source is not on GitHub under lvllvl's names.       | Code search for distinctive debug strings ("read ocean cartridge roml banks", "state high at %d", "pos too big!!!!!!") returns 0 hits. minimal64 has these debug prints removed. Caveat: code search indexes only default branches of indexed repos.                                                                                                                        |
| F3  | There is a sibling NES emulator by the same author.       | The same site copy has `lvllvl.com/js/nes/wasm/nes.wasm` (sha1 `b4e5738f…`, 31,590 bytes), with exports in the same style (`nes_init`, `nes_update`, `nes_getPixelBuffer`, `nes_step`, …).                                                                                                                                                                                  |
| F4  | The build carries no debug info.                          | No name section and no source paths. Only exports, printf strings and data remain.                                                                                                                                                                                                                                                                                          |
| F5  | It is C, not C++.                                         | Confirmed by F11: the matching source (minimal64) is plain C.                                                                                                                                                                                                                                                                                                               |
| F6  | Commodore ROMs are embedded.                              | The data section contains the KERNAL, BASIC, character and 1541 DOS ROM images ("CBM BASIC V2", "CBM DOS V2.6 1541" strings).                                                                                                                                                                                                                                               |
| F7  | The lvllvl repo has no license file.                      | `gh api repos/jaammees/lvllvl` → `license: null`. By default, all rights reserved.                                                                                                                                                                                                                                                                                          |
| F8  | It has a distinctive API and naming style.                | `*_readNS` (read with no side effects), `debugger_*`, `breakpoints_*Add` / `breakpoint_*Remove`, `c64_vicReadAbsolute`, a microcoded cycle-exact CPU, ref-counted IRQ/NMI lines.                                                                                                                                                                                            |
| F9  | Toolchain: Emscripten 1.39.7, LLVM (upstream) backend.    | See [B1](#b1-binary-forensics-done).                                                                                                                                                                                                                                                                                                                                        |
| F10 | `nopsta` is the lvllvl author.                            | The only commit in `nopsta/nopsta.github.io` (2023-11-15) is authored `jaammees <jaammees@gmail.com>`, the same identity as every `jaammees/lvllvl` commit. Every commit checked on both accounts carries an Adelaide offset (+1030 / +0930). The nopsta account was created 2022-10-15; minimal64 followed on 2022-11-06.                                                  |
| F11 | minimal64 is the same code base as c64.wasm.              | Function-level comparison: 70 of minimal64's emulator functions match a c64.wasm function at ≥0.6 similarity (24 are identical), versus **0** for an unrelated C64 core (floooh `chips`) used as a control. Matches cover the CPU, VIC, CIA, SID and cartridges, not just the CPU. See [B2](#b2-comparison-with-known-emulators-done).                                      |
| F12 | The SID filter is the same code.                          | Both binaries contain the same filter constants: −2π·12500/2048 = −38.3495 (8580), −2π·20000/2048 = −61.3592 (6581), 0.707 and −1381.6. minimal64's `filters.c` computes the first two by exactly that formula. c64.wasm's two `(i32, f32, f32, f32, i32) → f32` functions (421, 422) are minimal64's `sid_clock6581` / `sid_clock8580` with an added SID-instance pointer. |
| F13 | The CPU is a port of JSIDPlay2's `MOS6510`.               | minimal64's `m6510.c` header: "Based on MOS6510.java from JSidPlay2 by Ken Händel and Antti Lankila and mos6510c.i (C) 2000 by Simon White". c64.wasm func 324, the largest matched function (≈2,070 ops, about 200 table stores, called once from init), corresponds to `m6510_buildInstructionTable`.                                                                     |
| F14 | The upstreams are GPL.                                    | minimal64's headers credit SIDPLAY2 (Simon White), VICE, reSID (Dag Lem) and JSIDPlay2. Its LICENSE is GPL-2.0, and some files say "version 2 or later".                                                                                                                                                                                                                    |
| F15 | nes.wasm shares the CPU core and scheduler with c64.wasm. | 89 of nes.wasm's emulator functions match c64.wasm at ≥0.8, most of them identical: 86 in the CPU range (c64 funcs 213–330), plus 133, 210 and 211.                                                                                                                                                                                                                         |
| F16 | c64.wasm has more than minimal64.                         | minimal64 supports standard 8K/16K, Ocean Type 1, C64GS and Magic Desk cartridges. c64.wasm adds EasyFlash, GMod2, the 1541 drive, a debugger, snapshots and the mouse, and runs the real ROMs (F6). minimal64 ships a 252-byte custom KERNAL and no BASIC or character ROM.                                                                                                |

## B1. Binary forensics (done)

**Emscripten version.** lvllvl's glue (`wasm-c64.js`) was produced by the same build as the
binary: its `DYNAMICTOP_PTR=5583504`, `DYNAMIC_BASE=10826544` and `ASM_CONSTS={2288: c64_frame()}`
match the wasm. The glue's runtime source was compared against Emscripten tags 1.39.4–1.39.9
(`src/{library,shell,preamble,settings}.js`):

| Marker in the glue                        | 1.39.4 | 1.39.5 | 1.39.6 | **1.39.7** | 1.39.8 | 1.39.9 |
| ----------------------------------------- | ------ | ------ | ------ | ---------- | ------ | ------ |
| `wasi_snapshot_preview1` (glue: yes)      | no     | yes    | yes    | **yes**    | yes    | yes    |
| `readAsmConstArgs` (glue: yes)            | no     | no     | no     | **yes**    | yes    | yes    |
| `ENVIRONMENT_HAS_NODE` (glue: yes)        | yes    | yes    | yes    | **yes**    | no     | no     |
| `INITIAL_TOTAL_MEMORY` naming (glue: yes) | yes    | yes    | yes    | **yes**    | yes    | no     |

Only **1.39.7** (2020-02-03) matches all four. `__wasm_call_ctors` and `__growWasmMemory`
mark the upstream LLVM backend, not fastcomp.

**Runtime and libc:**

- **malloc:** dlmalloc, Emscripten's default. `malloc` is func 592 at 6,134 bytes, too
  big for emmalloc.
- **libc:** musl. The `vfprintf` tables (`-+   0X0x`, `0123456789ABCDEF`) are present, and
  musl libm `exp`/`log` constants (ln 2, 1/ln 2, the −745.13 underflow bound) are used by
  the SID filter setup.
- **Memory layout:** data ends at 5,583,492, followed by a 5 MiB stack (the default
  `TOTAL_STACK`). The initial memory is 16 MiB (256 pages), matching `INITIAL_PAGES` in
  `src/emulator/c64-wasm.ts`.
- **Function table:** 218 entries. Most are CPU microsteps (funcs 236–323), plus
  memory-bank read/write handlers (`c64_cpuRead`, `c64_ramRead`, `cia1_readNS`, …). This is
  the JSIDPlay2/libsidplay2 design: a per-cycle function-pointer table and per-bank
  handlers.

## B2. Comparison with known emulators (done)

Method: disassemble each binary with `wasm2wat`, then score every function against every
function in c64.wasm. The score combines opcode 4-gram shingles (immediates stripped) with
IDF-weighted constants. Each function keeps its best match. The scripts are in
[`tools/provenance/`](tools/provenance/).

| Compared with c64.wasm                            | Emulator functions ≥ 0.6 | 0.4–0.6 | Identical (1.00) |
| ------------------------------------------------- | ------------------------ | ------- | ---------------- |
| floooh `chips` C64, `tiny8bit/c64.wasm` (control) | **0**                    | 2       | 0                |
| `nopsta/minimal64` `build/m64.wasm`               | **70**                   | 54      | 24               |
| minimal64 vs the control (sanity check)           | 0                        | 6       | 0                |

minimal64 was compiled years later with a newer Emscripten at `-Os`, and it keeps its state
in globals where c64.wasm passes struct pointers. Many functions therefore differ in shape
even when the source is the same, which explains why the scores are lower than nes.wasm's.
Matched minimal64 functions are 36 in the CPU and 34 elsewhere (10 of those identical),
across the VIC, CIA, SID and cartridges.

Other candidates:

- **floooh `chips`:** ruled out (control above).
- **VICE, Frodo, VirtualC64, reSID/reSIDfp (C++):** not compared directly. minimal64's
  headers name the actual upstreams, which makes this unnecessary for questions 1 and 2.
- **Hermit's jsSID/cSID:** use similar cutoff formulas. The exact constants
  (12500/2048 and 20000/2048 with full π) match minimal64's `filters.c`, not Hermit's code.

Still open for B2: the provenance of the c64.wasm-only parts (F16), and JSIDPlay2's 1541,
VIA and cartridge classes as the likely source of the 1541 and EasyFlash code.

## B3. Same-author comparison (done)

`nes.wasm` matches c64.wasm far more closely than minimal64 does: 105 of its 136
non-trivial functions score ≥0.8. Of those, 17 are the shared Emscripten runtime and libc,
and 89 are emulator code. The emulator matches are the 6502 microcode functions, in the
same order and mostly identical, plus the event scheduler. Both were built with the same
toolchain from the same CPU source. That fits a single author with a personal emulator
code base, from which the C64, NES and later minimal64 were built.

## Licensing implications

This is not legal advice; it records what the evidence implies, for the maintainer to act on.

- c64.wasm is very likely a build of GPL-derived code: the author's own public release of
  the code base is GPL-2.0 and names GPL upstreams.
- c64-ready is MIT-licensed. It ships `public/c64.wasm` in the repo and in the npm package
  (`files` lists it). The README credits lvllvl but doesn't mention the GPL.
- The GPL expects distributed binaries to come with their corresponding source. Only part
  of c64.wasm's source is public (minimal64).
- Options:
  - add a third-party notice stating that `c64.wasm` is GPL-derived and separate from the
    MIT-licensed glue
  - get advice on whether the MIT glue is affected
  - long term, rebuild from GPL source (minimal64 plus what this disassembly recovers), so
    that c64-ready can ship a core with its full source

## Impact on the disassembly ([PLAN.md](PLAN.md))

- minimal64's source gives names, structs and commentary for most of the CPU, VIC, CIA, SID
  and cartridge code. For those subsystems, phases 1–3 become a matter of mapping functions
  to minimal64's source rather than reverse engineering them.
- **Exact mapping:** compiling minimal64 with Emscripten 1.39.7 and similar flags (Docker
  image `emscripten/emsdk:1.39.7`) should give near-identical function bodies, and a
  mechanical, verifiable name map.
- Real reverse engineering is then needed only for the c64.wasm-only parts listed in F16.

## Remaining plan

### B4. Historical record

- **Wayback Machine snapshots of lvllvl.com:** earlier `c64.wasm`/`c64.js` builds (a
  different build might contain debug info or source maps), plus credits, about,
  changelog and help pages. Look for a credit to JSIDPlay2 or VICE.
- **The author's public posts:** CSDb, Lemon64, Reddit, social media, any Patreon or
  Discord, describing how the emulator was built. Include the `nopsta` name.
- **`mwenge/llamaSource`:** context for why lvllvl.com was archived there, and any other
  archived files.

### B5. Outreach (maintainer's decision)

- **Who might know:** mwenge (llamaSource), the lvllvl user community and Commodore scene
  forums. With F10, the question to ask is narrower: whether the full C source of
  lvllvl's emulator (the minimal64 code base with the 1541 and the debugger) survives.
- **Who decides:** any contact is the maintainer's to make. Contacting family is out of
  scope unless the maintainer decides otherwise.

## Reproducing

- **Inputs:**
  - `public/c64.wasm` (strip the c64-ready export patch, or use the lvllvl original, sha1 `229ab902…`)
  - minimal64 `build/m64.wasm` (sha1 `01d31249…`)
  - `nes.wasm` from `mwenge/llamaSource` (sha1 `b4e5738f…`)
  - control: `https://floooh.github.io/tiny8bit/c64.wasm` (sha1 `287df627…` on 2026-11-23)
- **Steps:**
  1. `wasm2wat` each binary (wabt).
  2. `node tools/provenance/funcmatch.mjs a.wat c64.wat` gives the histogram; prefix
     `LIST=1` for the per-function pairs.
  3. `node tools/provenance/datacmp.mjs a.wasm c64.wasm` compares data sections. It is
     not conclusive on its own, because two Emscripten builds share musl tables.

## Log

- 2026-11-23: F1–F8 recorded while planning.
- 2026-11-23: B1:
  - Emscripten 1.39.7 identified from the glue markers, cross-checked against the tags.
  - dlmalloc, musl and the memory layout recorded.
- 2026-11-23: B2:
  - A GitHub code search for `cutoff_ratio_8580` led to `nopsta/minimal64`.
  - Function matching against minimal64 and the floooh control (F11–F14).
  - nopsta identified as jaammees through the nopsta.github.io commit identity and
    timezones (F10).
- 2026-11-23: B3: nes.wasm shares the CPU and scheduler (F15).
