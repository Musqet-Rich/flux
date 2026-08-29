#!/usr/bin/env node
import type { RpcErrorCode } from '@flux/protocol';
import { guards } from '@flux/protocol';
import { connect } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { createDaemon } from './create-daemon.ts';
import { DaemonError } from './daemon-error.ts';
import { qrMatrix } from './qr/qr-matrix.ts';
import { renderQr } from './qr/render-qr.ts';

// `flux daemon`: the box side of Flux (architecture.md § Daemon). Configuration is environment:
//   FLUX_RELAY_URL   the relay origin, e.g. https://flux.example.com (required)
//   FLUX_DATA_DIR    state directory, default ~/.flux
//   FLUX_REPOS_DIR   directory whose subdirectories are the repositories, default ~/repos
//   FLUX_CLAUDE      the claude binary, default `claude` on PATH
//   FLUX_PUSH_SUBJECT VAPID contact (mailto: or https: URL) shown to push services
//   FLUX_QR_INVERT   set to 1 on a light terminal; the pairing QR is drawn for a dark one
// `flux pair` asks a running daemon for a fresh pairing URL over its control socket; devices
// are managed with `flux devices ls|rm <id>` (which open the database directly, daemon stopped
// or not).

const { isRecord, isString } = guards;
const env = process.env;
const home = env['HOME'] ?? '/';
const dataDir = env['FLUX_DATA_DIR'] ?? join(home, '.flux');
const command = process.argv[2] ?? 'daemon';

// Asks the running daemon for a pairing URL; the socket is the daemon's only local interface.
// One request, one line back, so the reply is accumulated by hand: readline would re-emit the
// socket's errors on an Interface nobody listens to, and would say nothing if the daemon closed
// without replying.
const pairViaSocket = (): Promise<string> =>
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
      client.write('{"type":"pair"}\n');
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
      const url = isRecord(result) ? result['url'] : null;
      if (isString(url)) {
        settle(() => {
          resolve(url);
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
});

if (command === 'daemon') {
  await daemon.start();
  console.log(`flux daemon: relay ${relayUrl}`);
  // The pairing URL is a secret and minting one opens the pairing window, so it is shown only
  // to a person at a terminal; under systemd the operator runs `flux pair` when they mean it.
  if (process.stdout.isTTY) printPairing(daemon.pairingUrl());
  else console.log('run `flux pair` to pair a device');
  const shutdown = (): void => {
    daemon
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} else if (command === 'devices') {
  const sub = process.argv[3] ?? 'ls';
  if (sub === 'rm' && process.argv[4] !== undefined) {
    daemon.removeDevice(process.argv[4]);
    console.log(`removed ${process.argv[4]}`);
  } else {
    for (const d of daemon.devices()) console.log(`${d.deviceId}\t${d.name}\t${d.pairedAt}`);
  }
  await daemon.stop();
} else {
  console.error(
    `unknown command ${command}; use: flux daemon | flux pair | flux devices ls | flux devices rm <id>`,
  );
  await daemon.stop();
  process.exit(2);
}
