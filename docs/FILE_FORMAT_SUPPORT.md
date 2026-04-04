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



### Todo Implement Support for the following formats:
- [ ] .d64 - 5.25" Disk image files for C64
- [ ] .d81 - 3.5" Disk image files for C64
- [ ] .t64 - Tape image files for C64
- [ ] .prg - Program files for C64
- [ ] .p00 - Program files for C64
- [ ] .tap - Tape image files for C64
- [ ] vice snapshot files - .vsf, .vsx, .vsc, .vss
- [ ] .crt - Other cartridge formats not currently supported already.
