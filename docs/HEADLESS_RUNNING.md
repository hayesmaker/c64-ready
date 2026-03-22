// Copied from repository root HEADLESS_RUNNING.md
Headless runner — Initialization, troubleshooting, and release guidance
=======================================================================

This document explains how the headless runner initializes the C64 WebAssembly binary, common failure modes and fixes we've seen, how to build and use the compiled `dist-ts` wrapper for headless runs, and a plan for removing the need for a separate build step in the future.

Status (short)
--------------
- A minimal runtime wrapper lives in `src/headless/c64-wasm.mjs` so the CLI can instantiate the WASM without requiring the TypeScript-compiled `dist-ts`. The CLI (`bin/headless.mjs`) prefers this local wrapper and falls back to `dist-ts` if present.
- `dist-ts/emulator/c64-wasm.js` is the tested wrapper used by the browser build and is still the recommended, verified path when available.

Why two paths?
---------------
- `dist-ts` is the exact wrapper generated from the TypeScript sources; it is well-tested and matches browser behavior.
- Shipping a small JS shim in `src/headless` removes the need for consumers to have TypeScript/tsc available just to run the CLI from a git checkout.
- We keep the fallback to `dist-ts` because it is the canonical, tested instantiation path.

C64WASM initialization — step-by-step
------------------------------------
This is the ordering and essential operations the headless CLI performs when instantiating the WASM.

1. Read the `.wasm` binary from disk into an ArrayBuffer (e.g. `fs.readFile(wasmPath)`).

2. Create a WebAssembly.Memory instance sized to the expected initial pages:
```js
// Use a numeric placeholder (e.g. 256). Avoid angle-bracket tokens in docs
// which can be mis-parsed by some tooling: replace INITIAL_PAGES as needed.
const mem = new WebAssembly.Memory({ initial: 256 });
```
(We use 256 pages by default in the TS wrapper — that matches the compiled binary assumptions.)

3. Prepare the import object expected by the Emscripten/WASI-compiled binary:
- `env` imports used by the binary such as `memory`, `emscripten_get_sbrk_ptr`, `emscripten_resize_heap`, `emscripten_memcpy_big`, `table` (WebAssembly.Table), and small stubs like `setTempRet0`.
- `wasi_snapshot_preview1.fd_write` implementation which forwards fd=2 (stderr) to console.error.

4. Call `WebAssembly.instantiate(wasmBinary, importObject)` to instantiate the module, then save the exports:
```js
const result = await WebAssembly.instantiate(wasmBinary, importObject);
c64wasm.exports = result.instance.exports;
```

5. Update heap views (Uint8Array/Float32Array/Uint32Array) backed by `mem.buffer` so JS can access WASM memory:
```js
c64wasm.heap = {
  heapU8: new Uint8Array(mem.buffer),
  heapF32: new Float32Array(mem.buffer),
  heapU32: new Uint32Array(mem.buffer),
};
```
Any time the WASM memory grows (via `emscripten_resize_heap`), call `updateHeapViews()` again.

6. Initialise the sbrk/dynamic top pointer used by Emscripten malloc/free:
```js
new DataView(mem.buffer).setUint32(DYNAMICTOP_PTR, DYNAMIC_BASE, true);
```
(DYNAMICTOP_PTR and DYNAMIC_BASE are constants baked into the compiled binary.)

7. Call `__wasm_call_ctors()` if exported, to run static constructors.

8. Call runtime initialisation exports (these are specific to the emulator):
```js
exports.c64_init();
exports.sid_setSampleRate(44100);
exports.debugger_set_speed(100);
exports.debugger_play();
```
After these are complete the emulator exports and heap views are ready: `exports` and `heap` are used by the headless loop.

Common trouble points and how to troubleshoot them
-------------------------------------------------
Below are the failures we've observed and practical steps to diagnose and fix them.

1) "no-wasm"
- Symptom: CLI exits with `no-wasm` error (no WASM file found).
- Fix: Provide `--wasm <path>` pointing to `public/c64.wasm` or ensure `public/c64.wasm` exists. Verify with:
```bash
ls -la public/c64.wasm
```

2) C64WASM wrapper not found / "dist-ts wrapper failed to load"
- Symptom: The CLI prints a message that the wrapper failed and exits.
- Cause: Either `dist-ts` isn't built/installed, or the local `src/headless/c64-wasm.mjs` failed to import.
- Quick checks:
  - If you rely on `dist-ts`, build it locally: `npm run headless:build`.
  - If using the local wrapper, ensure `src/headless/c64-wasm.mjs` exists (present in this repo) and Node can import it (Node >= 24 recommended for stable ESM support).

3) WASM instantiation failed (exceptions thrown during instantiate)
- Symptom: Error `WASM instantiation failed: ...`.
- Causes and checks:
  - Wrong Node version / ESM support: ensure Node >= 18 (but we require >=24 in package.json). Check `node -v`.
  - Memory sizing wrong: compiled binary expects a specific DYNAMICTOP_PTR / INITIAL_PAGES — verify constants in `src/emulator/c64-wasm.ts` match the binary.
  - The WASM file is corrupted: try `wasm-objdump -x public/c64.wasm` or re-download the binary.

4) malloc/heap corruption after calling `allocAndWrite`
- Symptom: `allocAndWrite` fails or subsequent exports read/write incorrect memory.
- Causes and checks:
  - `updateHeapViews()` was not called after `malloc`/`mem.grow` — ensure code refreshes typed views after allocations or memory growth.
  - Incorrect DYNAMICTOP_PTR or DYNAMIC_BASE — values must match the binary. Mismatched values produce subtle malloc errors.

5) FFmpeg fails to start / libx264 produces invalid output
- Symptom: `ffmpeg` spawn fails or output file empty / corrupt when using libx264 (esp. on Windows).
- Checks & fixes:
  - Confirm ffmpeg is on $PATH: `ffmpeg -version`.
  - On Windows, libx264 encodes may fail depending on the ffmpeg build — fallback: record raw RGBA and convert afterward:
```bash
# record as raw then convert
ffmpeg -f rawvideo -pix_fmt rgba -s 384x272 -framerate 50 -i out.raw -c:v libx264 -pix_fmt yuv420p output.mp4
```
  - For RTMP streaming, make sure ffmpeg args include `-f flv` for RTMP outputs, and that Node-Media-Server (or your RTMP server) is reachable.

How to build and use `dist-ts` for headless runs (recommended when possible)
---------------------------------------------------------------------------
`dist-ts` contains the TypeScript-compiled JS wrapper that matches the browser runtime. When present the headless CLI will prefer it (fallback behavior can be toggled if you prefer).

Steps to build locally

1. From the repo root run:
```bash
npm install
npm run headless:build
```
`headless:build` runs `npx tsc -p tsconfig.build.json` and should produce `dist-ts/emulator/c64-wasm.js` plus tests in `dist-ts`.

2. Verify the artifact exists:
```bash
ls -la dist-ts/emulator/c64-wasm.js
```

3. Run the headless CLI using the built wrapper (the CLI will auto-detect `dist-ts`):
```bash
node bin/headless.mjs --wasm public/c64.wasm --no-game --frames 50
```

Why prefer `dist-ts` rather than the lightweight source shim?
- `dist-ts` is the canonical compiled wrapper that mirrors the browser environment and has been used extensively in tests. It contains the utilities used by higher-level emulator classes and has a known-good behaviour. The `src/headless` shim is intentionally minimal and may not contain every convenience or helper used elsewhere.

Options for publishing / distributing `dist-ts` without committing built files to git
------------------------------------------------------------------------------
We must avoid committing compiled artifacts to git while still making it easy for consumers to run the headless CLI. Here are safe approaches — pros/cons and recommended path are below.

Option 1 — Publish `dist-ts` as a separate npm package (recommended)
- Create a small package (e.g. `@c64-ready/dist-ts` or `c64-ready-dist-ts`) that contains the compiled wrapper only.
- CI builds the dist package and `npm publish`s it independently. The headless CLI package lists it as a dependency.
- Pros: consumers installing from npm get the prebuilt wrapper automatically; built artifacts are not tracked in git.
- Cons: requires publishing/updating two packages when the wrapper changes.

Implementation steps (summary):
```bash
# In your CI build job for the wrapper package
npm ci
npm run headless:build   # produce dist-ts
cd dist-ts              # or copy outputs to package folder
npm publish --access public
```
Then add `"@c64-ready/dist-ts": "^x.y.z"` to the headless package dependencies.

Option 2 — Build in CI and include in the published tarball only (keep out of git)
- CI runs `npm run headless:build` before `npm publish` for the headless package. The published tarball includes `dist-ts` because it is present at pack time and your `files` list references it.
- Pros: consumers installing the package via npm get `dist-ts` without any run-time network steps.
- Cons: CI must build with devDependencies available; publishing step must run in CI with build tooling installed.

Implementation steps (summary):
- On CI: run `npm ci`, `npm run headless:build`, then `npm publish`.

Option 3 — Keep the minimal runtime in `src/headless` (what we have now)
- The headless CLI can boot from the minimal JS shim and the raw `.wasm`. This has a small maintenance overhead (ensure the jig matches the compiled wrapper's semantics), but avoids shipping built files entirely.
- Pros: zero build step for consumers, no git-binary artifacts.
- Cons: the shim may diverge from the compiled runtime and could miss optimisations or features.

Recommended approach
--------------------
- Short term: keep the local shim in `src/headless` and retain `dist-ts` fallback. This lets developers run the CLI from a git checkout without building, while CI-based npm publishes (Option 2) or a separate wrapper package (Option 1) provide prebuilt wrappers to consumers.
- Long term (best): adopt Option 1 (separate published dist package). That keeps source clean, ensures consumers get a tested wrapper automatically, and avoids committing compiled files to git or running network operations at install time.

Plan to remove the build step entirely (longer-term roadmap)
----------------------------------------------------------
Goal: allow consumers to run the headless CLI straight from the repo or npm package without requiring a TypeScript build step, while keeping the advantages of the tested compiled wrapper.

Possible approaches:

1) Make the local shim a complete replacement for `dist-ts`:
- Expand `src/headless/c64-wasm.mjs` to implement all helper methods used by the rest of the codebase (allocAndWrite, updateHeapViews, etc.).
- Add tests that run the headless CLI against the browser-based behaviour to ensure parity with `dist-ts`.
- Risk: maintenance overhead; must keep the shim in sync with upstream wrapper changes.

2) Publish a prebuilt wrapper package to npm (Option 1 above) and make headless depend on it:
- CI builds and publishes the wrapper package. Consumers installing the headless package get the wrapper automatically with no build step.
- This approach better separates concerns and requires no changes for consumers.

3) Use a tiny runtime that dynamically adapts to the binary (WASI-only version):
- If the WASM binary can be built to use pure WASI or a well-known import surface, we could create one tiny loader that never needs to be recompiled.
- This depends on compilation flags and might require changes to the emulator's build pipeline.

4) Bundle the small shim into the published package at publish-time via CI (Option 2 above), but keep the shim out of git.
- This keeps git clean and avoids needing a separate package, but CI must be trusted to build before publish.

Suggested next steps (practical)
--------------------------------
1. Decide whether we want a separate npm package for `dist-ts` (Option 1). If yes, I can add a minimal package structure, CI steps, and instructions.
2. If we prefer a single-package flow, add CI build steps so `npm publish` occurs after building dist in CI (Option 2).
3. Expand the local shim incrementally to cover any missing helper methods so it can become a permanent replacement if desired. Add unit tests to ensure parity with `dist-ts`.

Quick reference: useful commands
--------------------------------
Build and test locally (dist-ts):
```bash
npm install
npm run headless:build
ls -la dist-ts/emulator/c64-wasm.js
node bin/headless.mjs --wasm public/c64.wasm --no-game --frames 10
```
Run using the source shim (no build):
```bash
node bin/headless.mjs --wasm public/c64.wasm --no-game --frames 10
```
If ffmpeg recording is required:
```bash
node bin/headless.mjs --wasm public/c64.wasm --record --output out.mp4 --duration 10
ffmpeg -f rawvideo -pix_fmt rgba -s 384x272 -framerate 50 -i out.raw -c:v libx264 -pix_fmt yuv420p out.mp4
```

## TLDR: Next Steps?
- Add a short CI job example (GitHub Actions) that builds `dist-ts` and publishes the wrapper package (or publishes the headless package after building dist in the job).
- Expand the `src/headless/c64-wasm.mjs` shim until it is a full drop-in alternative for `dist-ts`.

