# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Merge pull request #156 from hayesmaker/fix/attract-mode-fix (bb15cf3)
- fix: attract mode should reset emulator (be51c17)
- Merge pull request #154 from hayesmaker/feature/attract-mode (44ca9b6)
- chore: env.example attract mode vars (c1c943f)
- feat: added backend attract-mode (0ebaf96)
- Merge pull request #152 from hayesmaker/fix/attach-crt-filetype (ed5944f)
- fix: add filetype crt (06489f3)
- Merge pull request #150 from hayesmaker/fix/disk-keyboard-buffer (9bfb5cf)
- fix(workflows): check all commits in push for release detection (c5f609b)
- Merge pull request #148 from hayesmaker/fix/disk-keyboard-buffer (c31533b)

## v2.3.1 - 2026-05-16T12:31:50+01:00

- chore(release): 2.3.1 (fb25e7d)
- fix: use keyboard buffer disk auto run method (df68785)
- Merge pull request #147 from hayesmaker/chore/update-changelog-2026-05-16T10-17-04-575Z-998bb87 (36a178b)
- chore: update changelog (auto) (998bb87)
- Merge pull request #146 from hayesmaker/chore/improve-pr-checking (46e41b2)
- chore(workflows): skip changelog PR on release commits (9fb5801)
- chore: improve pr checking workflow (f7dcd9f)
- Merge pull request #144 from hayesmaker/feat/offline-d64-auto-run (9fca294)

## v2.3.0 - 2026-05-16T11:00:04+01:00

- chore(release): 2.3.0 (f8642e9)
- feat(headless): add auto-RUN after disk LOAD and fix audio startup race (062828d)
- feat: autorun disk (a879c57)
- Merge pull request #142 from hayesmaker/fix/array-buffer-typescript-failures (9db7b9b)
- fix: another ArrayBuffer fixup (628da43)
- Merge pull request #140 from hayesmaker/fix/array-buffer-typescript-failures (f5bd622)
- fix: use array buffer like types (9e253fa)
- Merge pull request #138 from hayesmaker/chore/cleanup-and-format (4f40388)
- chore: code cleanup and lint fixing (2cb3c5a)
- Merge pull request #136 from hayesmaker/feat/offline-disk-autoload (9850a8b)
- feat: offline and headless disk autoload parity (8cba1cc)
- Merge pull request #133 from hayesmaker/chore/bump-minor (85beda7)

## v2.2.0 - 2026-05-16T07:18:31+01:00

- chore(release): 2.2.0 (e768bce)
- Merge pull request #131 from hayesmaker/feature/audo-diskload (855307e)
- feat(headless): auto-load first mounted disk (de37688)
- Merge pull request #129 from hayesmaker/chore/prep-fix-bump (f8898b6)

## v2.1.1 - 2026-05-14T18:17:10+01:00

- chore(release): 2.1.1 (402ef33)
- Merge pull request #128 from hayesmaker/chore/update-changelog-2026-05-14T17-13-29-305Z-aaa29f1 (9f6e274)
- Merge branch 'master' into chore/update-changelog-2026-05-14T17-13-29-305Z-aaa29f1 (7e720dd)
- chore: update changelog (auto) (aaa29f1)
- Merge pull request #126 from hayesmaker/chore/update-changelog-2026-05-13T08-31-48-108Z-78c4565 (91272e8)
- Merge pull request #127 from hayesmaker/fix/prg-auto-run-reliability (ac1ddb4)
- chore: ignore tgz packs (cd11a92)
- chore: ensure normal builds exports (396df3e)
- fix(player): make PRG auto-run reliable (4532146)
- chore: update changelog (auto) (78c4565)
- Merge pull request #125 from hayesmaker/fix/headless-docker-build-tools (e295989)
- chore: fix docker publish workflow (a8a0773)
- Merge pull request #124 from hayesmaker/chore/update-changelog-2026-05-13T07-53-15-192Z-4e6e90f (a3c1275)
- chore: update changelog (auto) (4e6e90f)
- Merge pull request #123 from hayesmaker/feat/memory-read-api (e8ec073)

## v2.1.0 - 2026-05-13T08:51:29+01:00

- chore(release): 2.1.0 (b2d6ad4)
- feat(emulator): expose memory read helpers (1e9196a)
- Merge pull request #121 from hayesmaker/feat/player-export (a28cb6f)

## v2.0.0 - 2026-05-12T22:39:23+01:00

- chore(release): 2.0.0 (c1632f0)
- removing ui-controller from player index (0265398)
- feat(player): publish browser player API (79d6ff6)
- fix(player): restore snapshots and SID voice controls (10e85f8)
- feat(player): support direct game loading (7c61240)
- feat(player): barrel index and root export for C64Player, CanvasRenderer, AudioEngine - Add src/player/index.ts re-exporting all player classes - Update package.json '.' export to dist-ts/src/player/index.js so consumers   can do: import { C64Player, CanvasRenderer, AudioEngine } from 'c64-ready' - Add './types' export for the shared type-only index - Add './player' convenience alias pointing to same barrel (c47f663)
- feat(player): add package exports for player modules Expose dist-ts/src/player/* files via package exports so consumers can import C64Player, CanvasRenderer, and AudioEngine from c64-ready without Vite's import-analysis rejecting the deep path specifiers. (0cca05b)
- Merge pull request #119 from hayesmaker/chore/update-changelog-2026-05-10T20-28-45-513Z-18dfa77 (13e07f7)
- chore: update changelog (auto) (18dfa77)
- Merge pull request #118 from hayesmaker/release/v1.2.0 (c1d2aa2)
- chore: release script change to not require master (26f9580)

## v1.2.0 - 2026-05-10T19:03:26+01:00

## What's Changed
* chore(release): 1.1.0 by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/107
* feat(headless): add live snapshot save command by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/109
* chore: update CHANGELOG.md (auto) by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/110
* fix(webrtc): refresh TURN creds per ice request by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/112
* feat(input): add POT-backed extra fire buttons by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/114
* feat: added runstop and space bar to gamepad buttons by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/116
* chore: update CHANGELOG.md (auto) by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/117


**Full Changelog**: https://github.com/hayesmaker/c64-ready/compare/v1.1.0...v1.2.0

## v1.1.0 - 2026-04-26T16:23:34+01:00

- chore(release): 1.1.0 (a405719)
- Merge pull request #105 from hayesmaker/feature/snapshot-saving (6dfb5f7)
- fix(snapshot): use wasm snapshot pointer contract (0a7777a)
- feat(player): add snapshot save action (540058e)
- feat: new game - goat beat (494847e)
- Merge pull request #103 from hayesmaker/fix/webrtc-failure-debug (0d68566)
- fix(webrtc): include peer close diagnostics (fd36c9b)
- Merge pull request #101 from hayesmaker/feature/gamepad-analog-sticks (b54a46d)
- feat: left anaolog support for movement (a6f62e4)
- Merge pull request #99 from hayesmaker/feature/gamepad-support (06643dc)
- Merge branch 'feat/ui-gamepad-selector' into feature/gamepad-support (f06f1a6)
- feat(ui-controller): add connected gamepad selector (583b51d)
- feat: added gamepad buttons mapping to joystick (35d9546)
- WIP: initial buttons press release test (a958fa3)
- Merge pull request #98 from hayesmaker/chore/update-changelog-2026-04-22T14-40-46-866Z-904f20b (bd80a23)
- refactor: type jank (5403251)
- chore: update changelog (auto) (904f20b)
- Merge pull request #97 from hayesmaker/fix/admin-status-normalize-username (7c11063)
- fix(input): restore username normalization in admin status (3e0a4df)
- feat: initial gamepad connect/disconnect detection (b69b2cc)
- Merge pull request #96 from hayesmaker/chore/update-changelog-2026-04-21T19-33-07-906Z-b0548c5 (9ae3bed)
- chore: update changelog (auto) (b0548c5)
- Merge pull request #95 from hayesmaker/fix/spectator-admin-counts (17261da)
- fix(input): deduplicate spectator admin counts (159d540)
- Merge pull request #93 from hayesmaker/fix/webrtc-black-screen-keyframe (95b9753)
- fix(webrtc): force a keyframe for new peers (5af04f7)
- Merge pull request #91 from hayesmaker/fix/chat-activity-afk-reset (6f7554c)
- fix(input): reset AFK timers from admin activity (f1ffd2d)
- Merge pull request #89 from hayesmaker/feat/webrtc-input-datachannel (6ed2d7d)
- feat(webrtc): accept live input over data channels (dc6b267)
- Merge pull request #85 from hayesmaker/test/forced-host-reclaim (76bd1d6)
- Merge pull request #86 from hayesmaker/feat/lobby-ice-config (6b26408)
- updated env example to include ICE/TURN vars (9106265)
- feat(webrtc): expose ICE config endpoint (8d7de1f)
- test(headless): cover forced host reclaim (81b2dfa)
- Merge pull request #83 from hayesmaker/fix/default-max-spectators-10 (8bb542f)
- fix: change default max spectators to 10 (ad5f5ef)
- Merge pull request #80 from hayesmaker/chore/prep-fix-release (f059c4d)

## v1.0.1 - 2026-04-17T09:12:10+01:00

Adds crt preload checks. Rejects loading Ultimax flagged crts with hwType=0 (normal cart).  Provides override flag to allow dangerously loading invalid crt types but still provides user feedback when trying to load known dangerous types.

## v1.0.0 - 2026-04-16T23:12:30+01:00

Initial C64-Live release!

## 0.11.0 - 2026-04-11T10:50:57+01:00

## What's Changed
* Chore/deploy and release by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/36
* Feature/add prg support by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/37
* Feature/live settings parity backend by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/38
* fix(d64): reset state before headless disk insert by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/39
* Chore/prepare deployment 0.11.0 by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/40


**Full Changelog**: https://github.com/hayesmaker/c64-ready/compare/v0.10.0...0.11.0

## v0.10.0 - 2026-04-09T09:24:54+01:00

## What's Changed
* Fix/input flood instrumentation by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/34
* feat(headless): improve WebRTC stability, telemetry, and admin controls by @hayesmaker in https://github.com/hayesmaker/c64-ready/pull/35


**Full Changelog**: https://github.com/hayesmaker/c64-ready/compare/v0.8.0...v0.10.0

## v0.8.0 - 2026-04-05T08:53:20+01:00

Headless multiplayer tested and working on C64cade. See CHANGELOG.md for specific details.

## v0.6.2 - 2026-03-27T20:43:20Z

**Full Changelog**: https://github.com/hayesmaker/c64-ready/compare/v0.6.1...v0.6.2

## v0.6.1 - 2026-03-27T20:36:27Z

- chore(release): 0.6.1 (27df16c)
- fix: serve path corrected for running emulator via npm (56b9f1a)
- chore: updated changelogs (e9c6320)

## v0.6.0 - 2026-03-27T20:21:42Z

- chore(release): 0.6.0 (fce6cf9)
- chore(release): 0.5.2 (cbf9175)
- feat: added input handling api to the headless runner (73eebfb)
- fix(headless): use correct output path relative to project (299607e)
- chore: add cartridges to headless npm (f8d72c9)
- Merge pull request #20 from hayesmaker/feature/headless-audio (ba60d4b)
- feat: headless player with audio working good (4203361)
- fix: docker env file reading (3761a76)
- Merge pull request #19 from hayesmaker/chore/docker-headless (da1d530)
- chore: Docker docs (054323d)
- chore: changelogs (auto) (2a3dab0)
- chore: dockerized headless c64 player (7bc7770)
- chore: cleanup source files (27925b4)

## v0.5.1 - 2026-03-23T10:09:37Z

## What's Changed
* fix(browser): joystick keys detached when opening ui panels


**Full Changelog**: https://github.com/hayesmaker/c64-ready/compare/v0.5.0...v0.5.1

## v0.5.0 - 2026-03-23T08:56:08Z


- chore: fix typings and UI controller behavior for joystick/display settings (e843785)
- Merge remote-tracking branch 'origin/master' (2f5150f)
- chore(release): 0.5.0 (1c67934)
- chore: update changelog (auto) [skip ci] (07c46ba)
- Merge pull request #18 from hayesmaker/feature/more-ui-controller-settings (7557af9)
- chore: fix lints (45d0b3d)
- feat: simple input and display settings (c5e60b1)
- chore(styles): extract inline CSS to module styles/ and import as raw (74f1d41)



## v0.4.0 - 2026-03-22T23:27:35Z

## What's Changed
* chore: release script enhancements 
* chore(release): generate changelog inside release commit
* feature/headless cli runner 


**Full Changelog**: https://github.com/hayesmaker/c64-ready/compare/v0.3.0...v0.4.0

## v0.3.0 - 2026-03-21T15:16:11Z

Added Audio support - Now load Robocop3.crt and enjoy!

**Full Changelog**: https://github.com/hayesmaker/c64-ready/compare/v0.2.0...v0.3.0

## v0.2.0 - 2026-03-21T13:25:25Z

**Full Changelog**: https://github.com/hayesmaker/c64-ready/compare/v0.1.0...v0.2.0

## v0.1.0 - 2026-03-20T23:42:38Z

First release of C64-ready. 

Emulator working, and loading Legend of Wilf, with default keyboard controls.
No Audio support.
Github pages deployments.

