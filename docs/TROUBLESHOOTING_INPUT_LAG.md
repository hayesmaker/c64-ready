# Troubleshooting Input Lag (C64-Live)

This guide focuses on the common case where players report "input lag" in C64-Live, but the root cause may be either:

- input transport latency (WebSocket path), or
- delayed video playout (WebRTC jitter/drift accumulation).

The recent diagnostics work adds enough telemetry to separate these causes quickly.

## Five-point implementation checklist

1. **Use true client RTT for network quality**
   - Ping quality should be measured on the client (`pong received - ping sent`).
   - Do not use server `now - clientTime` as RTT; that value is clock-offset sensitive.

2. **Use true input RTT via input acknowledgements**
   - Every input event (`joystick`/`key`) carries an `inputId`.
   - Server responds with `input-ack` for each accepted input.
   - Client computes `input RTT` from local send/ack timestamps.

3. **Use windowed jitter for video status**
   - Primary jitter metric: `delta(jitterBufferDelay) / delta(jitterBufferEmittedCount)`.
   - Cumulative jitter average is debug-only and should not drive status.

4. **Add derived decode/network indicators**
   - `decode fps`, `frame drop rate`, `packet loss rate`, `freeze delta`, `decode ms/frame`.
   - Use these to diagnose whether delay creep is network-loss, decode pressure, or buffering behavior.

5. **Capture reproducible session evidence**
   - Use the runbook template below during real sessions.
   - Correlate perceived lag timestamps with telemetry snapshots.

## What to trust in the UI

- **Network badge**
  - `Ping`: client-measured WebSocket RTT.
  - `Input RTT`: client-measured input ack RTT.
- **Video badge**
  - `Drift`: live edge distance (`buffered.end - currentTime`).
  - `Jitter`: windowed/EMA jitter value.
  - `Decode`: decode fps.

If ping/input RTT are healthy but gameplay feels delayed, the issue is likely video playout delay, not input transport.

## Recommended thresholds (starting point)

- Network degraded: RTT >= 120 ms
- Network poor: RTT >= 220 ms
- Video delayed: `max(drift, jitter_ema) >= 40 ms`
- Video poor: `max(drift, jitter_ema) >= 70 ms`

Tune these after collecting session data.

### Auto-resync controls (frontend env)

The frontend supports controlled automatic video resync using these env vars:

- `VITE_AUTO_RESYNC` (`1`/`0`, default `1`)
- `VITE_AUTO_RESYNC_POOR_MS` (default `70`)
- `VITE_AUTO_RESYNC_HOLD_MS` (default `8000`)
- `VITE_AUTO_RESYNC_COOLDOWN_MS` (default `45000`)
- `VITE_AUTO_RESYNC_MAX_PER_WINDOW` (default `3`)
- `VITE_AUTO_RESYNC_WINDOW_MS` (default `600000`)

Policy default: auto-resync triggers when video delay stays above `VITE_AUTO_RESYNC_POOR_MS`
for `VITE_AUTO_RESYNC_HOLD_MS`, respecting cooldown and max-per-window limits.

## Quick triage flow

1. Check `Ping` and `Input RTT`.
2. If both are low but lag is felt, check `Drift` and `Jitter`.
3. If `Jitter`/`Drift` climb over time and resync clears lag, focus on video pipeline.
4. If RTT is high, investigate network path first.

## Single session runbook template

Copy this block for each live test session:

```text
Session ID:
Date/Time:
Host region/network:
Client region/network:
Game:
Build/branch (frontend):
Build/branch (headless):
Flags: --fps=, --log-events=, --verbose=, --log-file=

Start snapshot (T+00:00)
- Ping RTT:
- Input RTT:
- Drift ms:
- Jitter window ms:
- Jitter EMA ms:
- Decode fps:
- Frame drop rate:
- Packet loss rate:
- Freeze delta:
- Perceived lag (none/low/med/high):

Checkpoint A (first noticeable lag)
- Timestamp:
- Ping RTT:
- Input RTT:
- Drift ms:
- Jitter window ms:
- Jitter EMA ms:
- Decode fps:
- Frame drop rate:
- Packet loss rate:
- Freeze delta:
- Perceived lag:

Checkpoint B (severe lag)
- Timestamp:
- Ping RTT:
- Input RTT:
- Drift ms:
- Jitter window ms:
- Jitter EMA ms:
- Decode fps:
- Frame drop rate:
- Packet loss rate:
- Freeze delta:
- Perceived lag:

Action taken
- Manual resync pressed? (yes/no)
- Timestamp:

Post-resync snapshot (+10s)
- Ping RTT:
- Input RTT:
- Drift ms:
- Jitter window ms:
- Jitter EMA ms:
- Decode fps:
- Frame drop rate:
- Packet loss rate:
- Freeze delta:
- Perceived lag:

Conclusion
- Root-cause hypothesis:
- Evidence lines/log references:
- Follow-up action:
```

## Log review tips

- Headless logs (`logs/headless-*.log`) are best for server timing and events.
- Browser console is best for client-side WebRTC telemetry and perceived-lag correlation.
- Avoid concluding from a single metric; compare RTT + drift + jitter + decode together.
