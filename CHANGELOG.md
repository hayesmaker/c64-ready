# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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

