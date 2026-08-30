import type { ServiceConfig } from './build-service-config.ts';
import type { ServiceIo } from './service-io.ts';
import { servicePaths } from './service-paths.ts';

// `flux service status`: report whether the supervisor manifest is installed (its file is on
// disk) and loaded (the init system says so). It only reads — a probe command's non-zero exit is
// "not loaded", never an error — so status never changes the box.

const yesNo = (flag: boolean, yes: string, no: string): string => (flag ? yes : no);

const statusSystemd = async (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  const installed = io.exists(paths.unit);
  const active = (await io.run(['systemctl', 'is-active', 'flux-daemon'])).code === 0;
  return [
    `systemd unit ${paths.unit}: ${yesNo(installed, 'installed', 'not installed')}`,
    `flux-daemon: ${yesNo(active, 'active', 'not active')}`,
  ];
};

const statusLaunchd = async (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  const installed = io.exists(paths.launchAgent);
  const loaded = (await io.run(['launchctl', 'list', 'com.flux.daemon'])).code === 0;
  return [
    `LaunchAgent ${paths.launchAgent}: ${yesNo(installed, 'installed', 'not installed')}`,
    `com.flux.daemon: ${yesNo(loaded, 'loaded', 'not loaded')}`,
  ];
};

const statusWrapper = (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  const paths = servicePaths(config);
  const installed = io.exists(paths.wrapper);
  return Promise.resolve([
    `restart-loop wrapper ${paths.wrapper}: ${yesNo(installed, 'installed', 'not installed')}`,
    'no init system here; whether it is running is for you to check',
  ]);
};

export const serviceStatus = (config: ServiceConfig, io: ServiceIo): Promise<string[]> => {
  if (config.host === 'systemd') return statusSystemd(config, io);
  if (config.host === 'launchd') return statusLaunchd(config, io);
  return statusWrapper(config, io);
};
