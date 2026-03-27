# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

No unreleased changes.

## v0.6.0 - 2026-03-27T20:21:42+00:00

- feat: added input handling api to the headless runner (73eebfb)
- fix(headless): use correct output path relative to project (299607e)
- chore: add cartridges to headless npm (f8d72c9)
- feat: headless player with audio working good (4203361)
- fix: docker env file reading (3761a76)
- chore: dockerized headless c64 player (7bc7770)
- chore: Docker docs (054323d)
- chore: cleanup source files (27925b4)

## v0.5.1 - 2026-03-23T10:09:37+00:00

- fix: detach keyboard input when ui panels present (baa80a1)
- chore: fix node24 in deploy workflow (a948be5)

## v0.5.0 - 2026-03-23T09:12:04+00:00

- chore: fix typings and UI controller behavior for joystick/display settings (e843785)
- feat: simple input and display settings (c5e60b1)
- chore(styles): extract inline CSS to module styles/ and import as raw (74f1d41)

## v0.4.0 - 2026-03-22T23:27:35+00:00

- feat(headless): adds a headless c64 emulation mode (715f943)
- feat(headless): headless runner first commit (acb9e7f)
- chore(release): generate changelog inside release commit; add --local to generator (d5687a3)
- chore: release script enhancements (920a654)
- chore: docs re-org (2efa3c0)
- chore(docs): keep CHANGELOG.md at repo root and update publish script (a2e1292)
- chore(tests): remove tests from src; canonical tests now under test/ (5aef5d6)
- chore: remove duplicate cartridge in games/; use public/games as canonical asset (87bd78d)
- chore(headless): prefer public/games for default cartridge; remove repo-level fallback (10b5c8f)
- chore: fix lints (7242ab0)

## v0.3.0 - 2026-03-21T15:16:11+00:00

- feat: audio support (ee0f378)
- chore: filter changelogs from frontend (3192369)
- fix: changelog requests (8be31d6)
- ci: use Node 24 in changelog workflow (02065db)
- chore: fix changelog action (5675eda)

## v0.2.0 - 2026-03-21T13:25:25+00:00

- feat: adds cart loading support (559d866)
- chore: added wiki project overview (865c003)
- chore: added prettier linting and cleanup of source (c2e2199)
- feat: power led favicon (b8b4825)

## v0.1.0 - 2026-03-20T23:42:38+00:00

- feat: added github pages deployment (c55c362)
- feat: c64-ready gif (eecdea5)
- feat: render ticks and readme (696b107)
- feat: larger canvas view (d1d8856)
- feat: working proof of concept initial commit (89e9a6e)
