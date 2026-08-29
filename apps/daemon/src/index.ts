import { hostname } from 'node:os';
import { join } from 'node:path';

import { createDaemon } from './create-daemon.ts';

// `flux daemon`: the box side of Flux (architecture.md § Daemon). Configuration is environment:
//   FLUX_RELAY_URL   the relay origin, e.g. https://flux.example.com (required)
//   FLUX_DATA_DIR    state directory, default ~/.flux
//   FLUX_REPOS_DIR   directory whose subdirectories are the repositories, default ~/repos
//   FLUX_CLAUDE      the claude binary, default `claude` on PATH
// `flux pair` prints a pairing URL for a running daemon; devices are managed with
// `flux devices ls|rm <id>`. Both talk to the daemon over its control socket (next change).

const env = process.env;
const home = env['HOME'] ?? '/';
const relayUrl = env['FLUX_RELAY_URL'];
if (relayUrl === undefined) {
  console.error('FLUX_RELAY_URL is required');
  process.exit(2);
}

const daemon = await createDaemon({
  dataDir: env['FLUX_DATA_DIR'] ?? join(home, '.flux'),
  relayUrl,
  reposDir: env['FLUX_REPOS_DIR'] ?? join(home, 'repos'),
  daemonName: `flux@${hostname()}`,
  ...(env['FLUX_CLAUDE'] === undefined ? {} : { claudeCommand: env['FLUX_CLAUDE'] }),
});

const command = process.argv[2] ?? 'daemon';
if (command === 'daemon') {
  daemon.start();
  console.log(`flux daemon: relay ${relayUrl}`);
  const url = daemon.pairingUrl();
  console.log(`pair a device within 10 minutes: ${url}`);
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
    `unknown command ${command}; use: flux daemon | flux devices ls | flux devices rm <id>`,
  );
  await daemon.stop();
  process.exit(2);
}
