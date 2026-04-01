#!/bin/sh
# Entrypoint for the headless C64 player container.
# Reads environment variables and builds the correct argument list for
# bin/headless.mjs before exec'ing Node.

set -e

ARGS="--wasm ${WASM_PATH:-/app/public/c64.wasm}"

if [ -n "${GAME_PATH}" ]; then
  ARGS="$ARGS --game $GAME_PATH"
else
  ARGS="$ARGS --no-game"
fi

# ── Streaming mode ────────────────────────────────────────────────────────────
# WEBRTC_ENABLED=1  → low-latency WebRTC player page + signalling on WEBRTC_PORT.
#                     Input server is ALWAYS started in this mode (on WS_PORT)
#                     because the embedded browser page connects to it directly.
# Default (unset)   → legacy RTMP path via ffmpeg + Node-Media-Server.
#                     Input server only starts when INPUT_ENABLED=1.
if [ "${WEBRTC_ENABLED}" = "1" ] || [ "${WEBRTC_ENABLED}" = "true" ]; then
  echo "[entrypoint] MODE: WebRTC  (player → http://0.0.0.0:${WEBRTC_PORT:-9002}/  input → ws://0.0.0.0:${WS_PORT:-9001}/)"
  ARGS="$ARGS --webrtc"
  ARGS="$ARGS --webrtc-port ${WEBRTC_PORT:-9002}"
  # Input is always enabled in WebRTC mode — the browser page connects to it.
  ARGS="$ARGS --input"
  ARGS="$ARGS --ws-port ${WS_PORT:-9001}"
  # Spectator cap: players are excluded from this count (2 player slots are always reserved).
  if [ -n "${MAX_SPECTATORS}" ]; then
    ARGS="$ARGS --max-spectators $MAX_SPECTATORS"
  fi
else
  echo "[entrypoint] MODE: RTMP    (output → ${RTMP_URL:-rtmp://nms:1935/live/c64})"
  ARGS="$ARGS --record"
  ARGS="$ARGS --output ${RTMP_URL:-rtmp://nms:1935/live/c64}"

  # Enable SID audio muxing only when AUDIO is explicitly "1" or "true".
  if [ "${AUDIO}" = "1" ] || [ "${AUDIO}" = "true" ]; then
    ARGS="$ARGS --audio"
  fi

  # Input server is opt-in for RTMP mode.
  if [ "${INPUT_ENABLED}" = "1" ] || [ "${INPUT_ENABLED}" = "true" ]; then
    ARGS="$ARGS --input"
    ARGS="$ARGS --ws-port ${WS_PORT:-9001}"
  fi
fi

ARGS="$ARGS --fps ${FPS:-50}"

# Only pass --duration when explicitly set; omitting it means stream forever.
if [ -n "${DURATION}" ]; then
  ARGS="$ARGS --duration $DURATION"
fi

if [ "${VERBOSE}" = "1" ] || [ "${VERBOSE}" = "true" ]; then
  ARGS="$ARGS --verbose"
fi

if [ "${LOG_EVENTS}" = "1" ] || [ "${LOG_EVENTS}" = "true" ]; then
  ARGS="$ARGS --log-events"
fi

echo "[entrypoint] node bin/headless.mjs $ARGS"
# shellcheck disable=SC2086
exec node bin/headless.mjs $ARGS

