#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hayesmaker
// See LICENSE in the project root for full license information.
/**
 * c64-agent — deterministic load → run → inspect runner for LLM agents and test scripts.
 * Run `c64-agent --help` for usage, or see docs/AGENT_CLI.md.
 */
import { runAgent } from '../src/headless/agent-cli.mjs';

try {
  const { exitCode, output } = await runAgent();
  if (output) process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  process.exitCode = exitCode;
} catch (e) {
  process.stderr.write(`c64-agent: error: ${e && e.message ? e.message : e}\n`);
  process.exitCode = 1;
}
