![C64 Ready Prompt](./public/c64-ready/c64-ready.gif)

# c64-ready

`c64-ready` is a TypeScript/Vite frontend prototype for running and rendering a Commodore 64 emulator in the browser.

It is based on `c64.js (from lvllvl.com by James)` from the original project source: https://github.com/jaammees/lvllvl

## Goal

Build a clean, testable C64 emulator for the web, with a focus on:

- low-level WASM access,
- emulator control/state,
- canvas-based rendering
- node based headless rendering
- framework agnostic integration

## Install and run
- Prerequisites: Node.js 18+ and npm (see https://nodejs.org/)

Install dependencies:

```zsh
npm install
```

Start the dev server:

```zsh
npm run dev
```

Create a production build:

```zsh
npm run build
```

## Unit tests

This project uses Vitest with a jsdom environment (Jest-like API, faster integration with Vite/TypeScript).

### Covered modules

- `src/emulator/c64-wasm.ts`
- `src/emulator/c64-emulator.ts`
- `src/emulator/input.ts`
- `src/player/canvas-renderer.ts`
- `src/player/c64-player.ts`
- `src/player/ui-controller.ts`

Run tests:

```zsh
npm test
```

Run tests in watch mode:

```zsh
npm run test:watch
```

## Deployment

The project deploys to GitHub Pages automatically via GitHub Actions.

On every push to `master`:
1. Tests run (`npm test`)
2. If tests pass, a production build is created (`npm run build`)
3. The `dist/` output is deployed to GitHub Pages

### Setup (one-time)

1. Go to your repo on GitHub → **Settings → Pages**
2. Under **Source**, select **GitHub Actions**

### Live URL

https://hayesmaker.github.io/c64-ready/

## Work in Progress:
- Proof of Concept Implementation:
- [x] WASM module loading and initialization
- [x] Emulator control and state management
- [x] Canvas-based rendering
- [ ] Node-based headless rendering
- [x] Framework agnostic integration (e.g., Vanilla HTML+JS, React, Vue, Angular etc)
- Additional features:
- [ ] Audio output
- [x] Input handling (keyboard, gamepad, touch)
- [x] Loading and running C64 Files (e.g., .d64, .prg)
