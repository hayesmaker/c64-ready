# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

No unreleased changes.

## v0.7.0-rc.2 - 2026-03-31

### Critical fixes

- **fix(webrtc): WS ping/pong keepalive to prevent idle TCP timeout** (`031610d`)
  Root cause of the ~60 s stream freeze observed in production: after ICE negotiation
  completes the signalling WebSocket carries no further traffic. Cloud NAT, Docker bridge
  networking, and OS TCP stacks silently drop idle connections after ~60 s — exactly
  matching log evidence (`ws-closed` firing ~60 s after `webrtc-ice-connected` with no
  prior ICE disconnect event).
  Two-layer fix:
  - **Server** (`webrtc-server.mjs`): `setInterval` every 30 s sends `ws.ping()` to all
    connected signalling clients; tracks liveness via `ws._sigAlive` (reset on each pong).
    A client that misses a full ping interval (60 s total) is terminated and logged as
    `webrtc-sig-timeout` under `--log-events`. `clearInterval` called in `close()` to
    prevent timer leak.
  - **Browser** (embedded HTML): `sigPingTimer` sends `{type:'ping'}` every 30 s on the
    signalling WS; server replies with `{type:'pong'}` which the browser handles as a
    no-op. Timer is cleared in `sigWs.onclose` and `connectWebRTC()` teardown. `pong`
    message type handled in `sigWs.onmessage` to prevent JSON parse errors from
    unrecognised message types.

## v0.7.0-rc.1 - 2026-03-31

### Critical fixes

- **fix(webrtc): ICE `disconnected` no longer kills the stream** (`cc80281`)
  The server was calling `pc.close()` immediately on `iceConnectionState === 'disconnected'`,
  which is a transient state the ICE agent is supposed to self-recover from within a few seconds.
  Any brief packet loss, NAT keepalive gap or Node GC pause triggered it, permanently killing
  what would have been a recoverable connection and leaving the browser on a frozen frame.
  Fix: give ICE a 6-second grace period before closing. If it recovers to `connected/completed`
  the timer is cancelled and streaming resumes silently. Only `failed` / `closed` close immediately.

- **fix(webrtc): browser auto-reconnects instead of showing a dead badge** (`cc80281`)
  - On ICE `failed`: reconnect after 1 s
  - On signalling WS close: reconnect after 2 s (was a permanent error badge)
  - On `peer-closed` message from server: reconnect after 500 ms
  - On ICE `disconnected`: show `video: unstable…` badge and wait for server grace

### New features

- **feat(headless): `--log-events` flag for structured production logging** (`0e7f24c`, `cc80281`, `a674b0c`)
  A new CLI flag (completely independent of `--verbose`) that emits `[event] <ISO-timestamp> <tag> key=value …`
  lines to stderr for every meaningful state change — safe for always-on use in deployed instances.
  Never fires per frame. Covers:
  - Player lifecycle: `client-connected/disconnected`, `host-joined/rejoined/left/disconnected`,
    `host-grace-expired`, `host-timeout`, `host-kicked`, `p2-joined/left/disconnected/kicked`,
    `p2-promoted-to-host`, `p2-timeout`, `ports-swapped`
  - Emulator commands: `cmd-load-crt`, `cmd-detach-crt`, `cmd-hard-reset`
  - Outcomes: `cart-loaded`, `cart-detached`, `hard-reset` (each with gap ms)
  - WebRTC peer lifecycle: `webrtc-peer-connected/closed`, `webrtc-ice-connected/disconnected/terminal/grace-expired`
  - Drift warning when actual FPS deviates >10% from target
  - All errors: `bad-message`, `ws-error`, `server-error`, load/detach/reset failures
  - Input events include `role=host|p2` for attribution

- **feat(input-server): per-player inactivity timer for P2** (`a674b0c`)
  Previously only the host had a 5-minute inactivity timeout. P2 could hold the slot indefinitely.
  P2 now has an independent timer (same 5-minute duration) that resets on every joystick/key input
  and on join. Fires `p2-timeout-kick` to the P2 client and broadcasts `player2-left reason=timeout`.

- **feat(input-server): host reconnect grace period before P2 promotion** (`8436d5b`)
  When the host's WebSocket closes unexpectedly (e.g. browser refresh), P2 promotion is deferred
  for 8 seconds so the host can silently reclaim their slot. Clients receive `host-disconnected`
  with `graceMs` during the window. If the original host reconnects, `host-rejoined` is broadcast
  and the grace timer is cancelled. If nobody claims within 8 s, `host-left` + P2 promotion fires
  as before. Voluntary leave, inactivity kick and admin kick all bypass grace.

### Post-cart-load pipeline fixes (since v0.6.2)

- **fix(webrtc): reconnect `RTCPeerConnection` on cart-load to clear decoder state** (`c1301f0`)
  The browser VP8 decoder and jitter buffer accumulate stale state during the ~1600ms cart-load
  gap. A full `RTCPeerConnection` teardown + renegotiate (equivalent to a page refresh, but without
  dropping the input WebSocket) is the only reliable fix. Called on `cart-loaded`, `machine-reset`
  and `cart-detached`. Mute state preserved across reconnect.

- **fix(webrtc): force VP8 IDR keyframe after cart load/reset** (`e62a278`)
  After `c64_loadCartridge()` the VP8 encoder only emits a keyframe at its natural interval
  (~2–3 s). `forceKeyframe()` calls `sender.replaceTrack(sameTrack)` on all active peers,
  triggering an IDR within one frame period (≤20 ms @ 50 fps).

- **fix(webrtc): re-sync audio RTP clock after blocking WASM gaps** (`03b5e82`)
  `RTCAudioSource` is a push-source; its RTP clock freezes during the ~1300 ms cart-load blockage
  while the video RTP clock keeps ticking. `pushSilenceForGap(gapMs)` immediately compensates
  by pushing the equivalent silence chunks, re-aligning both clocks before the frame loop resumes.

- **fix(docker): `VERBOSE=0` now correctly disables verbose mode** (`be0d0b9`)
  `if [ -n "${VERBOSE}" ]` treated any non-empty string as truthy — including `VERBOSE=0`.
  Now checks for `1` or `true` only, consistent with `WEBRTC_ENABLED` and `AUDIO`.

- **fix(webrtc): blur UI elements on game load/reset/detach to prevent swallowed keypresses** (`94d8641`)

- **chore(docker): remove NMS service — WebRTC-only setup** (`258e0c9`)
  `docker-compose.yml` and `.env.example` simplified; `WEBRTC_ENABLED=1` and `AUDIO=1` are now
  the defaults.

### Tests

- `test(webrtc)`: new `webrtc-encoder.test.ts` and `webrtc-server.test.ts` covering
  `pushSilenceForGap`, audio ring drain, `forceKeyframe`, `connectWebRTC` teardown,
  mute-state preservation, and cart-load reconnect behaviour (`31f33ac`)

## v0.6.2 - 2026-03-27T20:43:20+00:00

- chore(release): 0.6.2 (d3cc8a0)
- fix: serve correct mimetypes in serve mode (096516d)
- chore: changelogs (auto) (68698eb)

## v0.6.1 - 2026-03-27T20:36:27+00:00

- chore(release): 0.6.1 (27df16c)
- fix: serve path corrected for running emulator via npm (56b9f1a)
- chore: updated changelogs (e9c6320)

## v0.6.0 - 2026-03-27T20:21:42+00:00

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

## v0.5.1 - 2026-03-23T10:09:37+00:00

- chore(release): 0.5.1 (8f3dae2)
- chore: update CHANGELOG.md (auto) (c9c5955)
- fix: detatch keyboard input when ui panels present (baa80a1)
- chore: fix node24 in deploy workflow (a948be5)
- chore: force node24 fix (25d1bc8)
- chore: update changelog (auto) [skip ci] (8e926b6)

## v0.5.0 - 2026-03-23T09:12:04+00:00

- chore: fix typings and UI controller behavior for joystick/display settings (e843785)
- Merge remote-tracking branch 'origin/master' (2f5150f)
- chore(release): 0.5.0 (1c67934)
- chore: update changelog (auto) [skip ci] (07c46ba)
- Merge pull request #18 from hayesmaker/feature/more-ui-controller-settings (7557af9)
- chore: fix lints (45d0b3d)
- feat: simple input and display settings (c5e60b1)
- chore(styles): extract inline CSS to module styles/ and import as raw (74f1d41)

## v0.4.0 - 2026-03-22T23:27:35+00:00

- chore(release): 0.4.0 (ccff6b7)
- Merge pull request #17 from hayesmaker/feature/headless-cli-runner (7bcd326)
- Merge branch 'master' into feature/headless-cli-runner (561a02b)
- chore: stop auto generated changelogs prs (a9822ca)
- chore: update changelog (auto) [skip ci] (0fefa3d)
- chore: update changelog (auto) [skip ci] (8a8668f)
- chore: update changelog (auto) [skip ci] (75373a5)
- chore: update changelog (auto) [skip ci] (a87a12a)
- Merge pull request #15 from hayesmaker/feature/headless-cli-runner (1b0b510)
- chore(release): generate changelog inside release commit; add --local to generator (d5687a3)
- Merge pull request #13 from hayesmaker/chore/update-changelog-2026-03-22T23-05-37-281Z-a1ccae7 (8f20c94)
- chore: update changelog (auto) [skip ci] (a1ccae7)
- Merge pull request #10 from hayesmaker/chore/update-changelog-2026-03-22T23-04-34-067Z-ae4bc22 (7365710)
- Merge pull request #11 from hayesmaker/feature/headless-cli-runner (78df809)
- chore: update changelog (auto) [skip ci] (ae4bc22)
- Merge pull request #9 from hayesmaker/chore/update-changelog-2026-03-22T18-25-45-840Z-bdf7b14 (e6e66d4)
- chore: release script enhancements (920a654)
- chore: update changelog (auto) [skip ci] (bdf7b14)
- Merge pull request #8 from hayesmaker/feature/headless-cli-runner (02ee198)
- chore: docs re-org (2efa3c0)
- chore(docs): keep CHANGELOG.md at repo root and update publish script (a2e1292)
- chore(docs): remove docs/CHANGELOG.md (keep root CHANGELOG.md) (726a914)
- chore(docs): move CHANGELOG.md back to repo root and restore generator output (27710f0)
- chore(docs): move repo root markdown into docs/ and update imports/generator (a713e07)
- chore(docs): add docs/ copies of repo root markdown and wiki publish helper (4089d45)
- chore(tests): remove tests from src; canonical tests now under test/ (5aef5d6)
- chore: remove duplicate cartridge in games/; use public/games as canonical asset (87bd78d)
- chore(headless): prefer public/games for default cartridge; remove repo-level fallback (10b5c8f)
- Merge pull request #6 from hayesmaker/chore/update-changelog-2026-03-21T15-22-06-743Z-5ae1fea (f887858)
- chore: fix lints (7242ab0)
- feat(headless): adds a headless c64 emulation mode (715f943)
- feat(headless): headless runner first commit (acb9e7f)
- chore: update changelog (auto) [skip ci] (5ae1fea)

## v0.3.0 - 2026-03-21T15:16:11+00:00

- chore(release): 0.3.0 (40d518c)
- feat: audio support (ee0f378)
- chore: filter changelogs from frontend (3192369)
- fix: changelog requests (8be31d6)
- chore: update changelog (auto) [skip ci] (ac19ea9)
- ci: trigger changelog workflow (node24) (0853680)
- ci: use Node 24 in changelog workflow (02065db)
- chore: fix changelog action (5675eda)

## v0.2.0 - 2026-03-21T13:25:25+00:00

- chore(release): 0.2.0 (991d9e7)
- chore: prepare release 0.2.0 (b31be4b)
- feat: adds cart loading support (559d866)
- chore: update changelog (auto) [skip ci] (9b1c57e)
- chore: update changelog (auto) [skip ci] (6c44232)
- chore: fix wiki (a6b1c9d)
- chore: link to overview from home wiki (bd91242)
- chore: attempt to fix wiki publish (30de988)
- chore: push plan to wiki (36e9639)
- chore: added wiki project overview (865c003)
- chore: added prettier linting and cleanup of source (c2e2199)
- chore: page link in banner (6cad53a)
- feat: power led favicon (b8b4825)
- chore: regenerated lockfile (fa871eb)

## v0.1.0 - 2026-03-20T23:42:38+00:00

- build: bump version to 0.1.0 (ef6ee3f)
- chore: ensure minimum node (2977a5e)
- feat: added github pages deployment (c55c362)
- chore: docs (2dff0bb)
- c64 ready (8ff3291)
- feat: c64-ready gif (eecdea5)
- feat: render ticks and readme (696b107)
- feat: larger canvas view (d1d8856)
- feat: working proof of concept initial commit (89e9a6e)

