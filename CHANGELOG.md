# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Merge pull request #59 from hayesmaker/chore/fix-docker-entrypoint (45225db)
- fix: fix entroypoint path for ephemeral setups (d696417)
- Merge pull request #57 from hayesmaker/chore/ghcr-c64-live-workflow (81e5439)
- chore: GHCR_PAT (68a6b9d)
- Merge pull request #55 from hayesmaker/chore/ghcr-c64-live-workflow (f10e09f)
- Merge branch 'chore/docker-env-defaults' into chore/ghcr-c64-live-workflow (2f449d3)
- chore(ci): publish c64-live image to ghcr (595f04d)
- chore(docker): add headless runtime env defaults (b6ed581)
- Merge pull request #52 from hayesmaker/chore/docker-ephemeral-headless (c92e065)
- chore(docker): bake headless runtime and remove dev bind mounts (1bb8803)
- Merge pull request #50 from hayesmaker/chore/docker-package-link (14c04da)
- chore: link docker package to repo (81789df)
- Merge pull request #48 from hayesmaker/fix/changelog-ci-checks (dcd8599)
- fix(ci): skip changelog workflow on changelog-only pushes (3d7368a)
- Merge pull request #46 from hayesmaker/chore/update-changelog-2026-04-12T06-55-05-920Z-950b3e8 (6721cff)
- chore: update changelog (auto) (950b3e8)
- Merge pull request #45 from hayesmaker/fix/changelog-ci-checks (4ecc113)
- fix(ci): allow changelog PR checks to run (898a459)
- Merge pull request #43 from hayesmaker/chore/fix-workflows (2a84b9a)
- fix(ci): create changelog PRs on push and clean wiki links (7449215)
- Merge pull request #42 from hayesmaker/feature/keyboard-tester (1c6589d)
- test: fixing tests to account for new mixed default (778730f)
- feat: keyboard tester tools (74eb259)
- feat(ui): add tools loader and mixed-mode restore defaults (a24cc52)
- tools: added anykey prg (48a86dc)
- Merge pull request #41 from hayesmaker/fix/live-d64-no-reset (f4bee9d)
- fix(d64): keep emulator running when mounting disk (9f6dc14)

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

