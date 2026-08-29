import { guards } from '@flux/protocol';
import { connect } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

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
const relayUrl = env['FLUX_RELAY_URL'];
if (relayUrl === undefined) {
  console.error('FLUX_RELAY_URL is required');
  process.exit(2);
}

const dataDir = env['FLUX_DATA_DIR'] ?? join(home, '.flux');
const command = process.argv[2] ?? 'daemon';

// Asks the running daemon for a pairing URL; the socket is the daemon's only local interface.
const pairViaSocket = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const client = connect(join(dataDir, 'control.sock'));
    client.on('error', () => {
      reject(new DaemonError('agent_unavailable', 'no running daemon (is `flux daemon` up?)'));
    });
    createInterface({ input: client }).once('line', (line) => {
      client.end();
      const reply: unknown = JSON.parse(line);
      const result = isRecord(reply) ? reply['result'] : null;
      const url = isRecord(result) ? result['url'] : null;
      if (isString(url)) resolve(url);
      else reject(new DaemonError('internal', 'daemon refused'));
    });
    client.on('connect', () => {
      client.write('{"type":"pair"}\n');
    });
  });

// The QR is for a person at a terminal; a pipe or journald gets the URL only.
const printPairing = (url: string): void => {
  if (process.stdout.isTTY) console.log(renderQr(qrMatrix(url), env['FLUX_QR_INVERT'] === '1'));
  console.log(`pair a device within 10 minutes: ${url}`);
};

if (command === 'pair') {
  printPairing(await pairViaSocket());
  process.exit(0);
}

const daemon = await createDaemon({
  dataDir,
  relayUrl,
  reposDir: env['FLUX_REPOS_DIR'] ?? join(home, 'repos'),
  daemonName: `flux@${hostname()}`,
  pushSubject: env['FLUX_PUSH_SUBJECT'] ?? `https://${hostname()}`,
  ...(env['FLUX_CLAUDE'] === undefined ? {} : { claudeCommand: env['FLUX_CLAUDE'] }),
});

if (command === 'daemon') {
  await daemon.start();
  console.log(`flux daemon: relay ${relayUrl}`);
  printPairing(daemon.pairingUrl());
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
