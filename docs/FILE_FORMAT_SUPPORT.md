## Game and Application File Format Support

### Currently Supported Formats
- .crt - Cartridge ROM files for C64

### Tested Good CRT formats (string revealed by the emulator):
- [x] normal cartridge / 

- [x] ocean type 1 cartridge
- [x] magic desk cartridge
- [x] easyflash cartridge
- [ ] 16KB cartridge
- [ ] 8KB cartridge

### Tested Bad CRT formats (string revealed by the emulator) including error messages:
- [x] normal cartridge / 16k cartridge
```
Uncaught RuntimeError: memory access out of bounds
```
- examples of this format include:
- Adventure Creator.crt (OneLoad cartridge - Official CRTs)

- [ ] unknown cartridge type
- examples of this format include:
- After the war.crt (OneLoad cartridge - Official CRTs)

---

### Known cartridge incompatibilities

All failures below are **WASM C core bugs** — they reproduce identically in the original `c64.js` Emscripten build using the same `.wasm` binary. They are not regressions introduced by c64-ready. The root fix in every case requires a patch to the C source and a recompile of the `.wasm` binary.

Detection: c64-ready runs a 60-frame PC uniqueness probe after every `c64_loadCartridge()` call. A machine with exactly 1 unique PC across 60 frames is flagged as stuck and surfaced as an amber `CARTRIDGE UNSUPPORTED` UI prompt.

Batch-tested against 83 known 8K cartridges: **58 OK, 25 STUCK, 0 crashes**.

---

#### Type A — Plain 8K normal (hwType=0, EXROM=0, GAME=1) — CPU stuck in KERNAL range

**Stuck address:** `$A47F` / `$A484` (KERNAL RAM area)  
**Affected examples:** `Adventure 1 - Mutant Spiders.crt`, `Adventure 3 - Fourth Sarcophagus.crt`

`c64_loadCartridge()` correctly maps the 8KB ROM at `$8000–$9FFF` and prints `"normal cartridge"`, but its internal reset leaves the CPU I/O port (`$01`) at `$F9` (LORAM=0, HIRAM=0, CHAREN=1). With KERNAL and BASIC both banked out, the 6502 reset vector at `$FFFC/$FFFD` reads from RAM (zeros), the CPU jumps to `$0000`, executes garbage, and settles into a spin loop in what should be KERNAL space. Hard reset does not recover — `c64_reset()` re-reads the WASM cart state and restores `$01` to `$F9`.

**Root fix required:** The WASM cart loader for EXROM=0/GAME=1 must restore `$01` to `$37` (LORAM=1, HIRAM=1, CHAREN=1) before triggering its internal reset.

---

#### Type B — MAX Machine cartridge (hwType=0, EXROM=1, GAME=0) — CPU stuck at `$0105`

**Stuck address:** `$0105` (zero page + 1, i.e. executing garbage RAM)  
**Affected examples:** `Avenger.crt`, `Avenger (MAX).crt`, `Clowns (MAX - v01/v02).crt`, `Jupiter Lander.crt`, `Kickman.crt`, `LeMans.crt`, `Mole Attack.crt`, `Money Wars.crt`, `Omega Race (MAX).crt`, `Radar Rat Race (MAX).crt`, `Road Race.crt`, `Sea Wolf.crt`, `Speed Math & Bingo Math.crt`, `Super Alien.crt`, `Visible Solar System.crt`, `Wizard of Wor (MAX v01/v02).crt` (21 carts total)

MAX Machine mode (EXROM=1, GAME=0) maps only the top 2KB of the 8K ROM at `$F800–$FFFF` as the reset/interrupt vector page, with RAM below. The WASM loader does not appear to implement this memory map correctly — the machine boots into RAM and spins at `$0105`.

**Root fix required:** Correct MAX Machine memory mapping in the WASM C core (EXROM=1, GAME=0 = 2K at `$F800`, no ROML).

---

#### Type C — 16K normal (hwType=0, EXROM=0, GAME=0) — CPU stuck at `$FF09`

**Stuck address:** `$FF09` (KERNAL ROM / RAM overlap area)  
**Affected examples:** `Space Action.crt`, `Tenpins.crt`

EXROM=0, GAME=0 maps 16K: ROML at `$8000` and ROMH at `$A000`. With a single 8K CHIP packet this results in ROMH (`$A000`) being unmapped or mirrored incorrectly, causing the KERNAL to jump into a bad address during the autostart sequence.

**Root fix required:** The WASM loader must handle the EXROM=0/GAME=0 (16K mode) correctly when only one CHIP packet is present.

---

#### Type D — Plain 8K normal (hwType=0, EXROM=0, GAME=1) variant — CPU stuck at `$1FD`

**Stuck address:** `$01FD` (stack area)  
**Affected examples:** `Checkers.crt`

Same hardware config as Type A but stuck at a different address, suggesting a different code path or a corrupted/unusual ROM layout.

---

### Todo Implement Support for the following formats:
- [ ] .d64 - 5.25" Disk image files for C64
- [ ] .d81 - 3.5" Disk image files for C64
- [ ] .t64 - Tape image files for C64
- [ ] .prg - Program files for C64
- [ ] .p00 - Program files for C64
- [ ] .tap - Tape image files for C64
- [ ] vice snapshot files - .vsf, .vsx, .vsc, .vss
- [ ] .crt - Other cartridge formats not currently supported already.
