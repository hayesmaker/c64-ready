[![C64 Ready Prompt](./public/c64-ready/c64-ready.gif)](https://hayesmaker.github.io/c64-ready/)

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

### Live URL

https://hayesmaker.github.io/c64-ready/

## Install and run locally
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


## Work in Progress:
- Proof of Concept Implementation:
- [x] WASM module loading and initialization
- [x] Emulator control and state management
- [x] Canvas-based rendering
- [x] Node-based headless rendering
- [x] Framework agnostic integration (e.g., Vanilla HTML+JS, React, Vue, Angular etc)
- Additional features:
- [x] Audio output
- [x] Input handling (keyboard)
- [x] Loading and running .crt cartridge roms
- [ ] Gamepad support
- [ ] Touch controls
- [ ] Display settings

## Changelog & Releases

This repository includes an automated changelog generator and a simple release workflow to help keep releases and the in-app version in sync.

- `tools/generate_changelog.js` builds `CHANGELOG.md` from git history and GitHub Release notes. In CI the generator opens a Pull Request with the updated `CHANGELOG.md` for review instead of committing directly to `master`.
- The CI workflow that runs the generator is `.github/workflows/generate_changelog.yml`. It runs on pushes to `master` and when a release is published.
- The wiki publisher (`.github/workflows/publish_wiki.yml`) runs on pushes to `master` and publishes `PROJECT_OVERVIEW.md` to the repository wiki.
Recommended release workflow (simple git flow)

If you prefer the standard git-based release flow (no `gh` CLI required), follow these steps:

1) Update the version and create a tag locally (npm will update package.json and create a tag):

```zsh
# bump the patch version (or use minor/major)
npm version patch -m "chore(release): %s"
```

2) Push the commit and tags to GitHub:

```zsh
git push origin master
git push --tags
```

3) Create a GitHub Release from the tag using the GitHub web UI:

- Go to your repository → Releases → Draft a new release
- Select the tag you just pushed, add release notes, and publish the release

What happens next

- Publishing a release will trigger the changelog workflow in CI. The generator will create or update `CHANGELOG.md` and open a Pull Request with the changelog changes for review. Merge that PR to update `master` with the changelog.
- The wiki publisher workflow runs on pushes to `master` and will publish `PROJECT_OVERVIEW.md` to the wiki when the changelog PR (or any other commit) is merged.

About tokens / authentication

- You do not need to provide secrets for GitHub Actions to run in CI: Actions injects an automatic `GITHUB_TOKEN` into workflow runs, and the workflows here use that token to create branches/PRs and push changes back to the same repository.
- If you run `tools/generate_changelog.js` locally and want it to push branches or create a PR from your machine, that script will use your local git credentials (SSH keys or credential helper); you do not have to set `GITHUB_TOKEN` locally unless you specifically want the script to authenticate via token.

Quick local tools

- Generate the changelog locally (writes `CHANGELOG.md` but will not create a PR unless CI runs the script with its `GITHUB_TOKEN`):

```zsh
node tools/generate_changelog.js
```

Verify the in-app version

- After bumping the version, rebuild the site so the new version is embedded in the app:

```zsh
npm run build
```

- Open the built site (or run the dev server) and check the Help dialog — the version (and short git hash when available) appears at the bottom.

