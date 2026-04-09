#!/usr/bin/env node

import WebSocket from 'ws';

function printHelp() {
  console.log(`
c64-admin - admin commands for c64-headless input server

Usage:
  c64-admin [global options] <command> [command options]

Global options:
  --ws-url <url>      Input WS URL (default: ws://127.0.0.1:9001)
  --token <token>     Admin token (or set C64_ADMIN_TOKEN)
  --json              Output JSON
  --help              Show help

Commands:
  status
      Show host/p2/spectator state and WebRTC peer counts.

  kick --player <host|p2>
      Kick one player.

  kick --all
      Kick host, p2, all spectators, and disconnect all WebRTC peers.

Examples:
  c64-admin --token "$C64_ADMIN_TOKEN" status
  c64-admin --token "$C64_ADMIN_TOKEN" kick --player host
  c64-admin --token "$C64_ADMIN_TOKEN" kick --all
`.trim());
}

function parseArgs(argv) {
  const args = [...argv];
  let wsUrl = process.env.C64_INPUT_WS_URL || 'ws://127.0.0.1:9001';
  let token = process.env.C64_ADMIN_TOKEN || '';
  let json = false;
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--ws-url') wsUrl = args[++i] ?? wsUrl;
    else if (a === '--token') token = args[++i] ?? token;
    else if (a === '--json') json = true;
    else positional.push(a);
  }

  const command = positional[0] ?? null;
  const commandArgs = positional.slice(1);
  return { help: false, wsUrl, token, json, command, commandArgs };
}

function parseCommand(command, commandArgs) {
  if (command === 'status') {
    return { type: 'admin-status' };
  }

  if (command === 'kick') {
    let target = null;
    let all = false;
    for (let i = 0; i < commandArgs.length; i++) {
      const a = commandArgs[i];
      if (a === '--all') all = true;
      else if (a === '--player') target = commandArgs[++i] ?? null;
    }
    if (all && target) throw new Error('Use either --all or --player, not both.');
    if (!all && !target) throw new Error('kick requires --all or --player <host|p2>.');
    if (all) return { type: 'admin-kick-all' };
    if (target !== 'host' && target !== 'p2') throw new Error('kick --player must be host or p2.');
    return { type: 'admin-kick-player', target };
  }

  throw new Error(`Unknown command: ${command ?? '(none)'}`);
}

function renderStatus(status) {
  const lines = [];
  const host = status?.host;
  const p2 = status?.p2;
  const spectators = Array.isArray(status?.spectators) ? status.spectators : [];
  const counts = status?.counts ?? {};

  if (host) {
    lines.push(`Host: ${host.username ?? '-'} (${host.connected ? 'connected' : 'disconnected'}) addr=${host.addr ?? '-'} webrtcPeers=${host.webrtcPeers ?? 0}`);
  } else {
    lines.push('Host: (none)');
  }

  if (p2) {
    lines.push(`P2: ${p2.username ?? '-'} (${p2.connected ? 'connected' : 'disconnected'}) addr=${p2.addr ?? '-'} webrtcPeers=${p2.webrtcPeers ?? 0}`);
  } else {
    lines.push('P2: (none)');
  }

  lines.push(`Spectators: ${spectators.length}`);
  spectators.forEach((s, idx) => {
    lines.push(`  ${idx + 1}. addr=${s.addr ?? '-'} webrtcPeers=${s.webrtcPeers ?? 0}`);
  });

  lines.push(`Counts: inputClients=${counts.inputClients ?? 0} spectators=${counts.spectators ?? 0} webrtcActive=${counts.webrtcActive ?? 0} webrtcPending=${counts.webrtcPending ?? 0} webrtcTotal=${counts.webrtcTotal ?? 0} webrtcAnonymous=${counts.anonymousWebrtcPeers ?? 0}`);
  return lines.join('\n');
}

function callAdmin(wsUrl, payload, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) {}
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for admin response.'));
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify(payload));
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') return;
      if (msg.type === 'admin-status-ok' || msg.type === 'admin-kick-player-ok' || msg.type === 'admin-kick-all-ok') {
        finish(resolve, msg);
        return;
      }
      if (msg.type === 'admin-error') {
        finish(reject, new Error(`Admin error: ${msg.command ?? 'unknown'} (${msg.reason ?? 'unknown'})`));
      }
    });

    ws.on('error', (err) => {
      finish(reject, err);
    });

    ws.on('close', () => {
      if (!settled) finish(reject, new Error('Connection closed before admin response.'));
    });
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  if (!parsed.token) {
    throw new Error('Missing admin token. Pass --token or set C64_ADMIN_TOKEN.');
  }

  const cmd = parseCommand(parsed.command, parsed.commandArgs);
  const payload = { ...cmd, token: parsed.token };
  const res = await callAdmin(parsed.wsUrl, payload);

  if (parsed.json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (res.type === 'admin-status-ok') {
    console.log(renderStatus(res.status));
    return;
  }

  if (res.type === 'admin-kick-player-ok') {
    console.log(`Kicked ${res.target}: ${res.username ?? '-'}`);
    console.log(renderStatus(res.status));
    return;
  }

  if (res.type === 'admin-kick-all-ok') {
    const kicked = res.kicked ?? {};
    console.log(`Kick-all complete: host=${kicked.host ?? '-'} p2=${kicked.p2 ?? '-'} spectators=${kicked.spectators ?? 0} webrtcPeers=${kicked.webrtcPeers ?? 0}`);
    console.log(renderStatus(res.status));
  }
}

main().catch((err) => {
  console.error(`Error: ${err?.message ?? String(err)}`);
  process.exit(1);
});
