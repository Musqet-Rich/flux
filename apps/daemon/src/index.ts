#!/usr/bin/env node
import type { RpcErrorCode } from '@flux/protocol';
import { guards } from '@flux/protocol';
import { connect } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';

import type { Daemon } from './create-daemon.ts';
import { createDaemon } from './create-daemon.ts';
import { DaemonError } from './daemon-error.ts';
import { qrMatrix } from './qr/qr-matrix.ts';
import { renderQr } from './qr/render-qr.ts';

// `flux daemon`: the box side of Flux (architecture.md § Daemon). Configuration is environment:
//   FLUX_RELAY_URL   the relay origin, e.g. https://flux.example.com (required)
//   FLUX_DATA_DIR    state directory, default ~/.flux
//   FLUX_REPOS_DIR   directory whose subdirectories are the repositories, default ~/repos
//   FLUX_CLAUDE      the claude binary, default `claude` on PATH
//   FLUX_CLAUDE_DIR  the agent's config directory (CLAUDE.md, settings.json), default ~/.claude
//   FLUX_PI          the pi binary, default `pi` on PATH
//   FLUX_PI_PROVIDER pi's --provider (e.g. anthropic); unset, pi's own settings decide
//   FLUX_PI_MODEL    pi's --model; unset, pi's own settings decide
//   FLUX_PUSH_SUBJECT VAPID contact (mailto: or https: URL) shown to push services
//   FLUX_QR_INVERT   set to 1 on a light terminal; the pairing QR is drawn for a dark one
// `flux pair` asks a running daemon for a fresh pairing URL over its control socket. `flux
// devices ls` opens the database directly; `flux devices rm <id>` goes through the socket too,
// so the live daemon cuts the device's channel off, and only falls back to the database when
// no daemon is running. The PWA's settings screen does the same over the wire; repos dir and
// notification triggers are changed there, the environment only sets their starting values.

const { isRecord, isString } = guards;
const env = process.env;
const home = env['HOME'] ?? '/';
const dataDir = env['FLUX_DATA_DIR'] ?? join(home, '.flux');
const command = process.argv[2] ?? 'daemon';

// One request to the running daemon; the socket is the daemon's only local interface. One line
// back, so the reply is accumulated by hand: readline would re-emit the socket's errors on an
// Interface nobody listens to, and would say nothing if the daemon closed without replying.
// Resolves with the reply's `result`; `agent_unavailable` means no daemon answered at all.
const controlRequest = (request: Record<string, unknown>): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const client = connect(join(dataDir, 'control.sock'));
    let buffer = '';
    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      client.end();
      outcome();
    };
    const fail = (code: RpcErrorCode, message: string): void => {
      settle(() => {
        reject(new DaemonError(code, message));
      });
    };
    client.on('error', (error) => {
      fail('agent_unavailable', `no running daemon (is \`flux daemon\` up?): ${error.message}`);
    });
    client.on('connect', () => {
      client.write(`${JSON.stringify(request)}\n`);
    });
    client.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const end = buffer.indexOf('\n');
      if (end === -1) return;
      let reply: unknown;
      try {
        reply = JSON.parse(buffer.slice(0, end));
      } catch {
        fail('internal', 'daemon sent an unreadable reply');
        return;
      }
      const result = isRecord(reply) ? reply['result'] : null;
      if (isRecord(result)) {
        settle(() => {
          resolve(result);
        });
      } else fail('internal', 'daemon refused');
    });
    client.on('close', () => {
      fail('internal', 'daemon closed without replying');
    });
  });

// The QR is for a person at a terminal; a pipe or journald gets the URL only.
const printPairing = (url: string): void => {
  if (process.stdout.isTTY) console.log(renderQr(qrMatrix(url), env['FLUX_QR_INVERT'] === '1'));
  console.log(`pair a device within 10 minutes: ${url}`);
};

const pairViaSocket = async (): Promise<string> => {
  const url = (await controlRequest({ type: 'pair' }))['url'];
  if (!isString(url)) throw new DaemonError('internal', 'daemon refused');
  return url;
};

// Revokes through the live daemon so the device is cut off now; without one, the database
// alone, which the next daemon start honours.
const removeDevice = async (daemon: Daemon, deviceId: string): Promise<void> => {
  try {
    await controlRequest({ type: 'devices.rm', deviceId });
    console.log(`removed ${deviceId}`);
  } catch (error) {
    if (!(error instanceof DaemonError) || error.code !== 'agent_unavailable') throw error;
    await daemon.removeDevice(deviceId);
    console.log(`removed ${deviceId} (no running daemon: revoked in the database only)`);
  }
};

// `pair` talks to the running daemon only, so it needs no relay URL: `flux pair` works from any
// shell of the daemon's user with the default data dir.
if (command === 'pair') {
  try {
    printPairing(await pairViaSocket());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  process.exit(0);
}

// Only `daemon` talks to the relay; `devices` opens the database and needs no URL, so it works
// from a login shell without the unit's environment file.
const relayUrl = env['FLUX_RELAY_URL'];
if (command === 'daemon' && relayUrl === undefined) {
  console.error('FLUX_RELAY_URL is required');
  process.exit(2);
}

const daemon = await createDaemon({
  dataDir,
  relayUrl: relayUrl ?? '',
  reposDir: env['FLUX_REPOS_DIR'] ?? join(home, 'repos'),
  daemonName: `flux@${hostname()}`,
  pushSubject: env['FLUX_PUSH_SUBJECT'] ?? `https://${hostname()}`,
  ...(env['FLUX_CLAUDE'] === undefined ? {} : { claudeCommand: env['FLUX_CLAUDE'] }),
  claudeDir: env['FLUX_CLAUDE_DIR'] ?? join(home, '.claude'),
  ...(env['FLUX_PI'] === undefined ? {} : { piCommand: env['FLUX_PI'] }),
  ...(env['FLUX_PI_PROVIDER'] === undefined ? {} : { piProvider: env['FLUX_PI_PROVIDER'] }),
  ...(env['FLUX_PI_MODEL'] === undefined ? {} : { piModel: env['FLUX_PI_MODEL'] }),
});

// SIGTERM stops the daemon within its budget (ADR 0017); a second signal, or the budget
// running out, exits at once rather than let a stuck agent keep two daemons alive.
const shutdownBudgetMs = 10_000;
const installShutdown = (): void => {
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) {
      console.error(`flux daemon: second ${signal}, exiting now`);
      process.exit(1);
    }
    stopping = true;
    console.error(`flux daemon: ${signal}, stopping`);
    setTimeout(() => {
      console.error('flux daemon: shutdown budget exceeded, exiting now');
      process.exit(1);
    }, shutdownBudgetMs).unref();
    daemon
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

const startDaemon = async (): Promise<void> => {
  try {
    const settled = await daemon.start();
    if (settled.asks > 0 || settled.sessions > 0) {
      console.log(
        `flux daemon: settled ${settled.asks} orphaned ask(s), ${settled.sessions} stuck session(s)`,
      );
    }
  } catch (error) {
    if (!(error instanceof DaemonError) || error.code !== 'conflict') throw error;
    console.error(error.message);
    process.exit(3);
  }
};

if (command === 'daemon') {
  await startDaemon();
  console.log(`flux daemon: relay ${relayUrl}`);
  const agents = daemon.agents.length === 0 ? 'none found on PATH' : daemon.agents.join(', ');
  console.log(`flux daemon: agents ${agents}`);
  // The pairing URL is a secret and minting one opens the pairing window, so it is shown only
  // to a person at a terminal; under systemd the operator runs `flux pair` when they mean it.
  if (process.stdout.isTTY) printPairing(daemon.pairingUrl());
  else console.log('run `flux pair` to pair a device');
  installShutdown();
} else if (command === 'devices') {
  const sub = process.argv[3] ?? 'ls';
  if (sub === 'rm' && process.argv[4] !== undefined) {
    try {
      await removeDevice(daemon, process.argv[4]);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      await daemon.stop();
      process.exit(1);
    }
  } else {
    for (const d of daemon.devices()) {
      console.log(`${d.deviceId}\t${d.name}\t${d.pairedAt}\t${d.lastSeenAt ?? 'never seen'}`);
    }
  }
  await daemon.stop();
} else {
  console.error(
    `unknown command ${command}; use: flux daemon | flux pair | flux devices ls | flux devices rm <id>`,
  );
  await daemon.stop();
  process.exit(2);
}
