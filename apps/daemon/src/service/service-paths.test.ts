import { expect, test } from 'vitest';

import type { ServiceConfig } from './build-service-config.ts';
import { servicePaths } from './service-paths.ts';

const config: ServiceConfig = {
  host: 'systemd',
  isRoot: false,
  user: 'flux',
  home: '/home/flux',
  node: '/usr/bin/node',
  entry: '/home/flux/flux/apps/daemon/dist/index.mjs',
  dataDir: '/home/flux/.flux',
  env: {},
};

test('resolves the well-known supervisor paths from the config', () => {
  expect(servicePaths(config)).toEqual({
    unit: '/etc/systemd/system/flux-daemon.service',
    staging: '/home/flux/.flux/flux-daemon.service',
    launchAgent: '/home/flux/Library/LaunchAgents/com.flux.daemon.plist',
    wrapper: '/home/flux/.flux/flux-daemon-run.sh',
    log: '/home/flux/.flux/flux-daemon.log',
  });
});
