# Where did c64.wasm come from?

An investigation into the origin of the source code behind `public/c64.wasm`. The binary
came from lvllvl.com, published on GitHub as `jaammees/lvllvl`. Its C source was never
published, and the author has since died.

Status: **planning**, with initial findings logged below.

## Questions

1. Was the core written by the lvllvl author, derived from an existing emulator, or a mix
   (for example, his own core with a borrowed SID)?
2. If it was derived, from which project and under what license? This determines what
   c64-ready may do with the binary and with this disassembly.
3. Does the source survive anywhere: an archive, a backup, someone who received a copy?

## Findings so far

| #   | Finding                                            | Evidence                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The binary is unchanged since at least 2021-01-02. | `mwenge/llamaSource` (a site copy, repo created 2021-01-02) has `lvllvl.com/js/c64/wasm/c64.wasm`, byte-identical to ours: sha1 `229ab902…`. The GitHub upload `jaammees/lvllvl` is a single "initial upload" commit on 2023-11-08.                                                                                           |
| F2  | The C source is not findable on GitHub.            | Code search for distinctive debug strings ("read ocean cartridge roml banks", "state high at %d", "pos too big!!!!!!") returns 0 hits. Only the JS glue (`c64_vicReadAbsolute`, `debugger_set_inspect_at`) appears, in lvllvl, llamaSource and c64-ready. Caveat: code search indexes only default branches of indexed repos. |
| F3  | There is a sibling emulator by the same author.    | The same site copy has `lvllvl.com/js/nes/wasm/nes.wasm` (sha1 `b4e5738f…`, 31,590 bytes), with exports in the same style (`nes_init`, `nes_update`, `nes_getPixelBuffer`, `nes_step`, …).                                                                                                                                    |
| F4  | The build carries no debug info.                   | No name section and no source paths. Only exports, printf strings and data remain.                                                                                                                                                                                                                                            |
| F5  | Probably C, not C++.                               | No mangled names in strings or exports. To be confirmed in B1.                                                                                                                                                                                                                                                                |
| F6  | Commodore ROMs are embedded.                       | The data section contains the KERNAL, BASIC, character and 1541 DOS ROM images ("CBM BASIC V2", "CBM DOS V2.6 1541" strings).                                                                                                                                                                                                 |
| F7  | The lvllvl repo has no license file.               | `gh api repos/jaammees/lvllvl` → `license: null`. By default, all rights reserved.                                                                                                                                                                                                                                            |
| F8  | It has a distinctive API and naming style.         | `*_readNS` (read with no side effects), `debugger_*`, `breakpoints_*Add` / `breakpoint_*Remove`, `c64_vicReadAbsolute`, a microcoded cycle-exact CPU, ref-counted IRQ/NMI lines.                                                                                                                                              |

## Plan

### B1. Binary forensics

- Pin the Emscripten version and flags. Fingerprints: `__growWasmMemory`, the `dynCall_*`
  exports, `setThrew`, `emscripten_asm_const_iii`, the `DYNAMICTOP_PTR`/`DYNAMIC_BASE`
  layout, and version markers in lvllvl's `c64.js` glue. Compare against Emscripten
  release builds.
- Identify the libc (musl version) and malloc (dlmalloc or emmalloc).
- Optimisation level: inlining patterns, and the presence of dead functions such as func
  396, which nothing calls.
- C or C++: look for exception, RTTI or vtable traces and `operator new`.
- Output: a build date range and toolchain description.

### B2. Comparison with known emulators

Compare structure, algorithms and constants against open-source C64 cores:

- VICE (x64 / x64sc)
- Frodo
- floooh's `chips` (`m6502.h`, `m6569.h`, `m6526.h`, `m6581.h`): plain C, often compiled
  to wasm, a strong candidate to rule in or out
- VirtualC64 (C++)
- older JS/C ports: jsc64, vice.js, and others

Checks:

- **SID:** waveform tables, filter curves and float constants, compared with reSID,
  reSIDfp and the SID code in floooh's `m6581.h`.
- **CPU:** the microcode/opcode table layout and the interrupt-sampling model, compared
  with each candidate's CPU core.
- **VIC-II:** the cycle-table layout and the badline handling.
- **Cartridges:** the set of supported types and their bank-switching code.

A match on any of these answers question 2 for that part.

### B3. Same-author comparison

Diff `nes.wasm` against `c64.wasm`:

- shared runtime and helpers
- struct conventions
- the debugger API shape
- the CPU (both are 6502-family)

If the NES core shares bespoke infrastructure, that strongly suggests the author wrote it
himself. The NES 2A03 core and the C64 6510 core sharing microcode structure would be
especially telling.

### B4. Historical record

- **Wayback Machine snapshots of lvllvl.com:** earlier `c64.wasm`/`c64.js` builds (a
  different build might contain debug info or source maps), plus credits, about,
  changelog and help pages.
- **The author's public posts:** CSDb, Lemon64, Reddit, social media, any Patreon or
  Discord, describing how the emulator was built.
- **`mwenge/llamaSource`:** context for why lvllvl.com was archived there, and any other
  archived files.

### B5. Outreach (maintainer's decision)

People who might know: mwenge (llamaSource), the lvllvl user community, and Commodore
scene forums. Any contact is the maintainer's to make. Contacting family is out of scope
unless the maintainer decides otherwise.

## Possible outcomes

- **An upstream is identified:** record the project, version and license, and assess what
  that means for redistributing the binary and this disassembly.
- **The author wrote it himself and never published it:** document the evidence (B1, B3,
  B4) and the confidence level.
- **A mix:** identify each borrowed part and its license.

## Log

Add dated entries as work proceeds: what was checked, what it showed, and links.

- 2026-11-23: F1–F8 recorded while planning (see above).
