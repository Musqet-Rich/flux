import { join } from 'node:path';

import type { ServiceConfig } from './build-service-config.ts';

// The well-known files a host's supervisor manifest lives at, and the daemon's log path. One
// place computes them so install, uninstall and status agree on what to write, remove and probe.
// `staging` is where a non-root systemd install drops the unit for the operator to `sudo cp` into
// place — under the data dir, which the daemon's user always owns (ADR 0022 § 6).

const UNIT_NAME = 'flux-daemon.service';
const LAUNCHD_LABEL = 'com.flux.daemon';

export interface ServicePaths {
  unit: string;
  staging: string;
  launchAgent: string;
  wrapper: string;
  log: string;
}

export const servicePaths = (config: ServiceConfig): ServicePaths => ({
  unit: join('/etc/systemd/system', UNIT_NAME),
  staging: join(config.dataDir, UNIT_NAME),
  launchAgent: join(config.home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
  wrapper: join(config.dataDir, 'flux-daemon-run.sh'),
  log: join(config.dataDir, 'flux-daemon.log'),
});
