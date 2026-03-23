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

## Headless streaming (Docker)

The headless player can stream the C64 output over RTMP / HTTP-FLV using Docker Compose.
Two containers are started:

| Container | Role |
|-----------|------|
| `c64-nms` | [Node Media Server](https://github.com/illuspas/Node-Media-Server) — RTMP ingest on `:1935`, HTTP-FLV on `:8000` |
| `c64-headless` | Headless C64 emulator — encodes frames with ffmpeg and pushes to NMS over RTMP |

**Prerequisites:** Docker and Docker Compose v2.

### Quick start

```zsh
# 1. Copy the env file (optional — defaults boot to BASIC, stream forever)
cp docker/.env.example .env

# 2. Build and start both services
docker compose up --build

# 3. Watch the stream
ffplay rtmp://localhost:1935/live/c64
# or open in VLC / OBS: http://localhost:8000/live/c64.flv
```

### Load a cartridge

Games are bind-mounted from `public/games/` — no rebuild needed:

```zsh
GAME_PATH=/app/public/games/cartridges/legend-of-wilf.crt docker compose up
```

### Environment variables

All options can be set in `.env` or passed inline. See `docker/.env.example` for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| `WASM_PATH` | `/app/public/c64.wasm` | Path to the WASM binary inside the container |
| `GAME_PATH` | *(empty)* | Cartridge/disk to load — leave blank to boot to BASIC |
| `RTMP_URL` | `rtmp://nms:1935/live/c64` | Stream destination (RTMP URL or file path) |
| `FPS` | `50` | Target frame rate (50 = PAL, 60 = NTSC) |
| `DURATION` | *(empty = forever)* | Stop after this many seconds — omit to stream indefinitely |
| `VERBOSE` | *(empty)* | Set to any non-empty value for per-frame diagnostics |
| `NMS_RTMP_HOST_PORT` | `1935` | Host port mapped to the NMS RTMP ingest |
| `NMS_HTTP_HOST_PORT` | `8000` | Host port mapped to the NMS HTTP-FLV endpoint |

### Stop

```zsh
docker compose down
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
- [x] Display settings
- [x] Docker headless streaming (RTMP / HTTP-FLV via Node Media Server)
- [ ] Gamepad support
- [ ] Touch controls

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

## Docs & Wiki publishing

This repository now keeps human-facing documentation in a `docs/` folder at the repository root (except for `AGENTS.md` and `README.md`, which remain in root).

- `docs/` contains user and developer docs that should be published to the repository wiki.
- The helper script `scripts/publish_wiki.sh` will prepare a wiki clone, copy `docs/*.md` plus the canonical `CHANGELOG.md` (from the repo root) into the wiki clone, update `Home.md` with links, and commit the changes so you can review before pushing.

To prepare a wiki update locally (no push):
```bash
# clone the wiki and stage the docs in the wiki clone (script prints the clone path)
./scripts/publish_wiki.sh git@github.com:YOUR_USER/c64-ready.wiki.git

# Inspect the prepared wiki clone (the script prints where it wrote files)
cd /tmp/<the-script-printed-path>/wiki
git status
git show --name-only
```

To publish the changes to the GitHub wiki (requires push access):
```bash
cd /tmp/<the-script-printed-path>/wiki
git push origin HEAD
```

Note: the script does not push to the wiki remote automatically to avoid accidental publishing. It also appends links to `Home.md` only if they are not already present.

## Release helper (`tools/release.sh`)

This project includes a small release helper script `./tools/release.sh` that wraps `npm version` and git push steps. The script now supports a safe `--dry-run` mode that reports the version that WOULD be created without modifying files, and a `--preid` option for prereleases.

Examples

- Dry-run a minor bump (no changes made):
```bash
./tools/release.sh minor --dry-run
# -> prints predicted new version (e.g. 0.4.0) and does not edit package.json
```

- Create the version commit and tag locally but do not push:
```bash
./tools/release.sh minor --no-push
# creates the commit and tag (npm version) locally so you can inspect before pushing
```

- Full release (commit, tag, and push to origin/master):
```bash
# Run this on master with a clean working tree
./tools/release.sh minor
```

- Create a prerelease (example with `beta` identifier) — dry-run:
```bash
./tools/release.sh preminor --preid beta --dry-run
# -> e.g. predicts 0.4.0-beta.0 without changing files
```

- Create a prerelease (create locally, no push):
```bash
./tools/release.sh prerelease --preid beta --no-push
# creates tag like v0.3.1-beta.0 locally
```

Notes and safety

- `--dry-run` will never edit `package.json` or create git commits/tags — it only prints the predicted version and the commands the script would run.
- Use `--no-push` to create the commit and tag locally for inspection, then push manually when you're ready.
- The script expects a clean working tree and will prompt if you are not on `master` (unless you use `--dry-run` which skips branch checks).

If you want, I can add examples to the CI workflow to automatically create releases on merges to `master` using this helper.

