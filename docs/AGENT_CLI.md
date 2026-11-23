# Agent CLI (`c64-agent`)

`c64-agent` is a one-shot **load → run → inspect** runner built for LLM coding agents,
CI jobs and test scripts. Give it a program, tell it how many frames to run and what
input to feed, and it prints a compact report: CPU registers, the decoded text screen,
memory dumps, and paths to any screenshots or video it wrote.

```zsh
npx -p c64-ready c64-agent game.prg --frames 250 --screen --screenshot shot.png
```

```
stop: frames after 250 frames (5s) · game.prg [prg $0801]
regs: PC=$0827 (game_loop) A=$10 X=$0b Y=$00 SP=$f6 P=nvBdIzc raster=35
video: text, screen $0400 (bank 0)
screenshots: /work/shot.png
screen:
┌────────────────────────────────────────┐
│READY.                                  │
│RUN                                     │
│            HELLO AGENT                 │
└────────────────────────────────────────┘
```

## Why it exists

The streaming CLI (`c64-headless`) runs in real time and is driven over a WebSocket,
which suits people watching a stream. An agent needs something else: a command that
finishes, returns text, and gives **the same result every run**. `c64-agent` counts time
in emulated PAL frames (one `debugger_update(20)` per frame) and never sleeps on the
wall clock, so a run of 3000 frames (60 emulated seconds) takes a few seconds and
can be repeated exactly.

## Loading

| File        | What happens                                                                           |
| ----------- | -------------------------------------------------------------------------------------- |
| `.prg`      | Injected into RAM. A `$0801` load address is started with `RUN`; anything else needs `--sys <addr>` (a warning says so) |
| `.d64`      | 1541 enabled, disk inserted, ~2 s drive boot, then `LOAD"*",8,1` and `RUN` typed        |
| `.crt`      | Cartridge attached (the core resets and starts it)                                     |
| `.c64`      | Native snapshot restored                                                                |
| _(none)_    | Boots to the BASIC `READY.` prompt                                                     |

`--no-run` loads without starting. Frame 0 is the first frame after loading.

## Input

Input is scheduled on frame numbers with `--at <frame>:<action>`:

```zsh
c64-agent game.prg --frames 400 \
  --at 50:press=space      `# tap SPACE (held for 3 frames)` \
  --at 100:joy2=right+fire `# hold right + fire on port 2` \
  --at 160:joy2=none       `# release the stick` \
  --at 200:screenshot=mid.png
```

- `type=<text>` writes PETSCII into the KERNAL keyboard buffer (`$0277`/`$C6`), 10
  characters at a time as it drains. `\n` is RETURN. Use this for BASIC and for programs
  that read keys with `GETIN`. `--type <text>` is shorthand for `--at 0:type=<text>`.
- `press=` / `hold=` / `release=` drive the **keyboard matrix** directly, so they work in
  games that scan CIA1. Names match `C64_KEY` (`SPACE`, `RETURN`, `F1`, `RUN_STOP`,
  `SHIFT_LEFT`, `A`–`Z`, `0`–`9`, …). Combine keys with `+`.
  `RESTORE` isn't in the matrix: it pulses the NMI line once on press, so
  `--at 100:hold=run_stop --at 103:press=restore` is RUN/STOP+RESTORE.
- `joy1=` / `joy2=` set the whole joystick state: any of `up down left right fire` joined
  with `+`, or `none`.
- `poke=<addr>=<v>[,v…]` writes memory mid-run; `--poke` does the same before frame 0.

## Stopping early

- `--break <addr>` (repeatable) sets a PC breakpoint. The run stops the moment the CPU
  reaches it, with `stopReason: "breakpoint"`.
- `--until-text <str>` stops when the text appears anywhere on the screen. If it never
  does, the exit code is **3**, which makes it easy to write pass/fail tests:

  ```zsh
  c64-agent tests.prg --until-text "ALL TESTS PASSED" --frames 3000 || echo FAIL
  ```

## Inspecting

| Flag                        | Output                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| _(default)_                 | stop reason, frames run, CPU registers, video mode and screen address   |
| `--screen`                  | Screen RAM decoded to text, found through `$DD00`/`$D018`, so it follows bank and screen moves |
| `--dump <a>-<b>` / `<a>:<n>` | Hex dump of CPU-visible memory, read without side effects (repeatable) |
| `--vic`                     | VIC-II registers `$D000`–`$D02E`                                        |
| `--screenshot <png>`        | PNG of the final frame (384×272, includes borders)                     |
| `--every <n> --shots-dir d` | A PNG every n frames                                                    |
| `--scale <n>`               | Integer upscale for PNGs                                                |
| `--video <file>`            | `.mp4`, `.webm` or `.gif` of the whole run (needs `ffmpeg` on PATH)     |
| `--save-snapshot <file>`    | Native `.c64` snapshot of the final state, loadable in the browser player |
| `--json`                    | The whole report as JSON (dumps as byte arrays)                         |

In text and bitmap modes alike, `--screen` reads whatever is in screen RAM. When the
report says `bitmap`, use a screenshot instead.

## Symbols

`--symbols <file>` reads a KickAssembler `.sym` file (`-symbolfile`), including
`.namespace` blocks, or a VICE label file (`al C:0810 .name`). Every address argument
can then be a label or `label+offset`, and the report shows the PC symbolically:

```zsh
java -jar KickAss.jar game.asm -o game.prg -symbolfile
c64-agent game.prg --symbols game.sym --break player_hit --dump lives:1
# regs: PC=$1a40 (player_hit) …
```

## Addresses

Hex by default, following monitor convention: `$c000`, `0xc000` and `c000` all mean
49152. Write `#49152` for decimal. In shells, quote anything that starts with `$`.

## Exit codes

| Code | Meaning                            |
| ---- | ---------------------------------- |
| 0    | Run completed                      |
| 1    | Bad arguments or load error        |
| 3    | `--until-text` was never reached   |

## Handing a program to a person

`c64-agent` is for checking a program. When a person should play it, hand them the
browser player with the file preloaded:

```zsh
npx c64-ready build/main.prg --open
```

The page boots straight into the program, and reloading it picks up a fresh build.

## Programmatic use

```js
import { runAgent } from 'c64-ready/src/headless/agent-cli.mjs';

const { exitCode, report } = await runAgent({
  argv: ['game.prg', '--frames', '100', '--dump', 'c000:4'],
  log: () => {},
});
console.log(report.dumps[0].bytes, report.regs.pc);
```

## Known limitations

- PAL timing only.
- `--break` covers PC breakpoints only. The core also has memory and raster
  breakpoints, which are not exposed here yet.
