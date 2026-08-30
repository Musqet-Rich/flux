import { dirname, join } from 'node:path';

import type { ServiceConfig } from './build-service-config.ts';
import { renderLaunchAgent } from './render-launch-agent.ts';
import { renderSystemdUnit } from './render-systemd-unit.ts';
import { renderWrapperScript } from './render-wrapper-script.ts';
import { runOrThrow } from './run-or-throw.ts';
import type { ServiceIo } from './service-io.ts';
import { servicePaths } from './service-paths.ts';

// `flux service install`: write the right supervisor manifest for the host and, where it can
// without escalating, load it (ADR 0022 § 6). Each branch returns the lines to print. Installing a
// system unit needs root: as root it lands in `/etc/systemd/system` and is enabled now; otherwise
// the unit is staged under the data dir and the exact `sudo` commands are printed — never a silent
// escalation. macOS and the no-init wrapper need no root at all.

const installSystemd = async (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  const unit = renderSystemdUnit(config);
  if (config.isRoot) {
    await io.writeFile(paths.unit, unit, 0o644);
    await runOrThrow(io, ['systemctl', 'daemon-reload']);
    await runOrThrow(io, ['systemctl', 'enable', '--now', 'flux-daemon']);
    return [`installed ${paths.unit}`, 'enabled and started flux-daemon (start-on-boot)'];
  }
  await io.mkdirp(dirname(paths.staging));
  await io.writeFile(paths.staging, unit, 0o644);
  return [
    `not root: staged the unit at ${paths.staging}`,
    'install it as a system service with:',
    `  sudo cp ${paths.staging} ${paths.unit}`,
    '  sudo systemctl daemon-reload',
    '  sudo systemctl enable --now flux-daemon',
  ];
};

const installLaunchd = async (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  await io.mkdirp(dirname(paths.launchAgent));
  await io.writeFile(paths.launchAgent, renderLaunchAgent(config), 0o644);
  // Reload if a stale copy is already loaded, ignoring the failure when it is not; then load.
  await io.run(['launchctl', 'unload', paths.launchAgent]);
  await runOrThrow(io, ['launchctl', 'load', '-w', paths.launchAgent]);
  return [
    `installed ${paths.launchAgent}`,
    'loaded com.flux.daemon; it runs while you are logged in',
    'a headless Mac that must run before login needs a root LaunchDaemon (see docs/releases.md)',
  ];
};

const installWrapper = async (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  await io.mkdirp(dirname(paths.wrapper));
  await io.writeFile(paths.wrapper, renderWrapperScript(config), 0o755);
  return [
    `wrote the restart-loop supervisor to ${paths.wrapper}`,
    'no init system here; keep it running so the self-update exit is followed by a restart:',
    `  nohup ${paths.wrapper} >> ${join(config.dataDir, 'flux-daemon.log')} 2>&1 &`,
    'or add it to your container/compose restart policy.',
  ];
};

export const installService = (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  if (config.host === 'systemd') return installSystemd(config, io);
  if (config.host === 'launchd') return installLaunchd(config, io);
  return installWrapper(config, io);
};
