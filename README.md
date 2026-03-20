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

- ## Install and run

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
- `src/player/canvas-renderer.ts`

Run tests:

```zsh
npm test
```

Run tests in watch mode:

```zsh
npm run test:watch
```

