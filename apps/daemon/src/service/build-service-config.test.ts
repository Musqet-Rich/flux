import { expect, test } from 'vitest';

import type { ServiceInput } from './build-service-config.ts';
import { buildServiceConfig } from './build-service-config.ts';

const base: ServiceInput = {
  platform: 'linux',
  hasSystemd: true,
  isRoot: false,
  installed: true,
  user: 'flux',
  home: '/home/flux',
  node: '/usr/bin/node',
  entry: '/home/flux/flux/apps/daemon/dist/index.mjs',
  dataDir: '/home/flux/.flux',
  env: {},
};

test('detects the host from platform and whether systemd is present', () => {
  expect(buildServiceConfig({ ...base, platform: 'darwin' }).host).toBe('launchd');
  expect(buildServiceConfig({ ...base, platform: 'linux', hasSystemd: true }).host).toBe('systemd');
  expect(buildServiceConfig({ ...base, platform: 'linux', hasSystemd: false }).host).toBe(
    'wrapper',
  );
  expect(buildServiceConfig({ ...base, platform: 'win32', hasSystemd: false }).host).toBe(
    'wrapper',
  );
});

test('bakes only PATH and FLUX_* env, sorted, dropping undefined values', () => {
  const config = buildServiceConfig({
    ...base,
    env: {
      PATH: '/usr/bin',
      FLUX_RELAY_URL: 'https://flux.example.com',
      FLUX_DATA_DIR: '/home/flux/.flux',
      HOME: '/home/flux',
      FLUX_GONE: undefined,
    },
  });
  expect(config.env).toEqual({
    FLUX_DATA_DIR: '/home/flux/.flux',
    FLUX_RELAY_URL: 'https://flux.example.com',
    PATH: '/usr/bin',
  });
  expect(Object.keys(config.env)).toEqual(['FLUX_DATA_DIR', 'FLUX_RELAY_URL', 'PATH']);
});

test('carries the host facts straight through', () => {
  const config = buildServiceConfig({ ...base, isRoot: true, user: 'root' });
  expect(config).toMatchObject({
    isRoot: true,
    user: 'root',
    home: '/home/flux',
    node: '/usr/bin/node',
    entry: '/home/flux/flux/apps/daemon/dist/index.mjs',
    dataDir: '/home/flux/.flux',
  });
});
