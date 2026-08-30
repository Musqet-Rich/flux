import type { ServiceConfig } from './build-service-config.ts';
import { runOrThrow } from './run-or-throw.ts';
import type { ServiceIo } from './service-io.ts';
import { servicePaths } from './service-paths.ts';

// `flux service uninstall`: reverse the install — unload the supervisor and remove its manifest.
// Symmetric with install on root: as root the system unit is disabled and removed; otherwise the
// staged copy is removed and the `sudo` removal is printed. The disable/unload steps ignore a
// "not loaded" failure so uninstall is idempotent.

const uninstallSystemd = async (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  if (config.isRoot) {
    await io.run(['systemctl', 'disable', '--now', 'flux-daemon']);
    if (io.exists(paths.unit)) await io.removeFile(paths.unit);
    await runOrThrow(io, ['systemctl', 'daemon-reload']);
    return [`removed ${paths.unit}`, 'disabled flux-daemon'];
  }
  if (io.exists(paths.staging)) await io.removeFile(paths.staging);
  return [
    `removed the staged unit ${paths.staging}`,
    'remove the installed system unit with:',
    '  sudo systemctl disable --now flux-daemon',
    `  sudo rm -f ${paths.unit}`,
    '  sudo systemctl daemon-reload',
  ];
};

const uninstallLaunchd = async (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  await io.run(['launchctl', 'unload', paths.launchAgent]);
  if (io.exists(paths.launchAgent)) await io.removeFile(paths.launchAgent);
  return [`removed ${paths.launchAgent}`, 'unloaded com.flux.daemon'];
};

const uninstallWrapper = async (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  if (io.exists(paths.wrapper)) await io.removeFile(paths.wrapper);
  return [`removed ${paths.wrapper}`, 'stop any running copy of it yourself'];
};

export const uninstallService = (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  if (config.host === 'systemd') return uninstallSystemd(config, io);
  if (config.host === 'launchd') return uninstallLaunchd(config, io);
  return uninstallWrapper(config, io);
};
