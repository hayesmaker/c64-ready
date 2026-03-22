// Copied from repository root PROJECT_OVERVIEW.md
# Project Overview — C64 Ready

This document is the canonical project overview and plan for the "C64 Ready" TypeScript rewrite of the original c64.js emulator glue.

Overview
- Purpose: provide a clean, modular TypeScript architecture around the existing WebAssembly C64 binary so the emulator can run in the browser (and headless environments) with testability and maintainability.
- Scope: rewrite the glue layer (WASM wrapper, emulator API, renderer, input, player) while keeping the original compiled WASM binary.

High-level architecture

```
┌─────────────────────────────────────────────────┐
│         Application Layer (e.g., Vue)           │
└─────────┬───────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│     C64Player (Browser UI + Input)              │
│  ├─ CanvasRenderer                              │
│  ├─ AudioEngine (Web Audio API)                 │
│  └─ InputHandler (Keyboard/Joystick)            │
└─────────┬───────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│      C64Emulator (Core Logic)                   │
│  ├─ C64WASM (wrapper around .wasm binary)       │
│  ├─ Memory (heap management)                    │
│  └─ Constants (addresses, opcodes, etc)         │
└─────────┬───────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│  WebAssembly Binary (CPU, Chipsets, ROM)        │
│  (unchanged from original c64.wasm)             │
└─────────────────────────────────────────────────┘
```

Headless variant (Node.js) replaces CanvasRenderer/AudioEngine/InputHandler with streaming and capture components.

File structure (current)

```
src/
├── emulator/
│   ├─ c64-wasm.ts        # WASM wrapper (instantiation, memory)
│   ├─ c64-emulator.ts    # High-level emulator API
│   ├─ constants.ts       # Joystick / format constants
│   └─ input.ts           # Joystick mappings
├── player/
│   ├─ c64-player.ts      # Player orchestration (startup, load)
│   ├─ canvas-renderer.ts # Canvas rendering and rAF loop
│   ├─ input-handler.ts   # Integrates EmulatorInput into app
│   └─ ui-controller.ts   # Small UI helpers (help dialog)
├── headless/             # headless capture & ffmpeg (work in progress)
└── index.html + entrypoints
```

What has been implemented
- WASM wrapper with proper memory handling and malloc/sbrk support
- C64Emulator API exposing frame/audio callbacks, loadGame, memory access
- CanvasRenderer with rAF-driven variable-delta tick support
- Emulator input layer and Player input handler mapping keyboard -> joystick
- C64Player orchestration (WASM init, renderer/input wiring, cartridge loading)
- UIController (help dialog) and small UI glue
- Unit tests with Vitest for emulator, WASM, renderer, player, and UI modules
- CI: GitHub Actions workflows for tests, build, and GitHub Pages deployment

Planned / Future work (short)
- Headless streaming (frame+audio capture & ffmpeg runner)
- Audio engine integration and high-quality SID emulation hooks
- Additional input options (touch, on-screen joystick, gamepad remapping)
- More integration tests and example apps (React / Vue)

Notes
- Code examples that were in the original plan have been removed from this overview — source code is available in `src/` and tests.
- The original `c64.js` reference has been moved to `temp/` for archival/reference only.

Feedback and contributions
- This repo is MIT-licensed — contributions welcome. For architecture discussions, open an issue or PR.

