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

ARGS="$ARGS --record"
ARGS="$ARGS --output ${RTMP_URL:-rtmp://nms:1935/live/c64}"
ARGS="$ARGS --fps ${FPS:-50}"

# Only pass --duration when explicitly set; omitting it means stream forever.
if [ -n "${DURATION}" ]; then
  ARGS="$ARGS --duration $DURATION"
fi

if [ -n "${VERBOSE}" ]; then
  ARGS="$ARGS --verbose"
fi

echo "[entrypoint] node bin/headless.mjs $ARGS"
# shellcheck disable=SC2086
exec node bin/headless.mjs $ARGS

