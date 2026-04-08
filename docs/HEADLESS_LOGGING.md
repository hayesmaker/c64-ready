# C64-Ready Logging Guide

## Overview

The headless C64 emulator can write all console output to log files that persist across Docker container restarts. This is useful for debugging issues, investigating input floods, and monitoring production behavior.

## Quick Start

### Local Development

Run with the `--log-file` flag:

```bash
node src/headless/headless-cli.mjs --wasm public/c64.wasm --webrtc --input --log-file
```

Logs are written to `logs/headless-YYYYMMDD-HHMMSS.log` in the repo root.

### Docker Production

Enable logging via environment variables in `docker/.env`:

```env
LOG_FILE=1
LOG_RETAIN_DAYS=7
```

The `docker-compose.yml` bind-mounts `./logs:/app/logs` so logs survive container restarts.

## CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--log-file` | Enable log file output | `false` |
| `--log-retain-days N` | Purge logs older than N days on startup | `7` |

## Log File Location

- **Local**: `<repo-root>/logs/headless-YYYYMMDD-HHMMSS.log`
- **Docker**: `/app/logs/headless-YYYYMMDD-HHMMSS.log` (mapped to host `./logs`)

The `logs/` directory is gitignored and automatically created on first run.

## Log Retention

- Logs older than `--log-retain-days` are deleted on each startup.
- Default: 7 days
- Set to `0` to disable cleanup (logs will accumulate indefinitely)

## What Gets Logged

All console output (`console.log` and `console.error`) is tee'd to both stdout/stderr and the log file. This includes:

- Startup messages and config
- Input flood instrumentation (`[input-flood]`)
- Event loop lag reports (`[input-flood] event-loop-lag`)
- Player connect/disconnect events
- Cartridge load/reset events
- WebRTC connection state
- Errors and warnings
- Input latency summaries (`[input-latency] host-avg=... p2-avg=...`)
- Input latency spikes (`[input-latency] spike role=... latency=...`)
- Ping round-trip times (`[ping] role=... rtt=...`)

## Docker Volume Mount

The `docker-compose.yml` includes:

```yaml
volumes:
  - ./logs:/app/logs
```

This ensures:
1. Logs are written to the host's `./logs` directory
2. Logs persist when the container is stopped/removed
3. Logs are accessible for inspection without entering the container

## Viewing Logs

### Local

```bash
# List log files
ls -la logs/

# Tail the latest log
tail -f logs/$(ls -t logs/headless-*.log | head -1)

# Search for input flood events
grep "input-flood" logs/headless-*.log
```

### Docker

```bash
# From host
ls -la logs/
tail -f logs/headless-*.log

# Inside container
docker exec -it c64-headless ls -la /app/logs
docker exec -it c64-headless tail -f /app/logs/headless-*.log
```

## Log Rotation

Log files are NOT rotated mid-run. Each invocation creates a new file with a timestamp. Old logs are cleaned up based on `--log-retain-days`.

For more aggressive rotation (e.g., hourly), consider adding a cron job or external log rotation script.
