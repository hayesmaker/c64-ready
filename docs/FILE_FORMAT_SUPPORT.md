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

#### Plain 8K normal cartridge (hwType=0, EXROM=0, GAME=1)

**Status:** Loads silently but CPU is frozen — unusable.  
**Affected examples:** `adventure1-the-mutant-spiders.crt`  
**Also fails in:** The original `c64.js` Emscripten implementation using the same `.wasm` binary — confirming this is a **WASM C core bug**, not something introduced by c64-ready.

**Technical diagnosis:**  
The WASM `c64_loadCartridge()` correctly maps the 8KB ROM at `$8000–$9FFF` and prints `"normal cartridge"` to stdout, but its internal reset routine leaves the CPU I/O port register (`$01`) at `$F9` (LORAM=0, HIRAM=0, CHAREN=1). With both LORAM and HIRAM low, the KERNAL and BASIC ROMs are **both banked out** and replaced by RAM. The 6502 reset vector at `$FFFC/$FFFD` reads from RAM (zeros), so the CPU jumps to `$0000`, executes garbage, and ends up spinning in an infinite loop at `$A47F`. The emulator surface shows a blank/crashed BASIC screen with no text or cursor.

Calling `c64_reset()` afterwards does not help — the WASM reset handler reads back its own internal cart state and restores `$01` to `$F9` again.

**Detection:** c64-ready detects this via the stuck-CPU heuristic: after load, 3 frames of `debugger_update()` are run and the PC is checked before and after. If `PC₀ === PC₁`, a `c64-cart-load-failed` event is dispatched and the UI shows an amber `CARTRIDGE UNSUPPORTED` prompt.

**Root fix required:** The WASM C core's `c64_reset()` / `c64_loadCartridge()` for plain 8K normal carts must restore the CPU I/O port to `$37` (LORAM=1, HIRAM=1, CHAREN=1) so the KERNAL autostart sequence can run. This requires a fix in the C source and a recompile of the `.wasm` binary.

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
