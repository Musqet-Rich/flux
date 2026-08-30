import { expect, test } from 'vitest';

import type { ServiceConfig } from './build-service-config.ts';
import type { CommandResult, ServiceIo } from './service-io.ts';
import { servicePaths } from './service-paths.ts';
import { serviceStatus } from './service-status.ts';

const fakeIo = (present: Set<string>, probeCode: number): ServiceIo => ({
  exists: (path) => present.has(path),
  writeFile: () => Promise.resolve(),
  removeFile: () => Promise.resolve(),
  mkdirp: () => Promise.resolve(),
  run: () => {
    const result: CommandResult = { code: probeCode, stdout: '', stderr: '' };
    return Promise.resolve(result);
  },
});

const linux: ServiceConfig = {
  host: 'systemd',
  isRoot: false,
  user: 'flux',
  home: '/home/flux',
  node: '/usr/bin/node',
  entry: '/home/flux/flux/apps/daemon/dist/index.mjs',
  dataDir: '/home/flux/.flux',
  env: {},
};
const paths = servicePaths(linux);

test('systemd reports installed and active from the unit file and is-active', async () => {
  const active = await serviceStatus(linux, fakeIo(new Set([paths.unit]), 0));
  expect(active).toEqual([`systemd unit ${paths.unit}: installed`, 'flux-daemon: active']);
  const idle = await serviceStatus(linux, fakeIo(new Set(), 3));
  expect(idle).toEqual([`systemd unit ${paths.unit}: not installed`, 'flux-daemon: not active']);
});

test('launchd reports installed and loaded from the plist and launchctl list', async () => {
  const mac: ServiceConfig = { ...linux, host: 'launchd', home: '/Users/rich' };
  const macPaths = servicePaths(mac);
  const loaded = await serviceStatus(mac, fakeIo(new Set([macPaths.launchAgent]), 0));
  expect(loaded).toEqual([
    `LaunchAgent ${macPaths.launchAgent}: installed`,
    'com.flux.daemon: loaded',
  ]);
  const gone = await serviceStatus(mac, fakeIo(new Set(), 1));
  expect(gone).toEqual([
    `LaunchAgent ${macPaths.launchAgent}: not installed`,
    'com.flux.daemon: not loaded',
  ]);
});

test('wrapper reports only whether the script is present', async () => {
  const box: ServiceConfig = { ...linux, host: 'wrapper' };
  const boxPaths = servicePaths(box);
  const there = await serviceStatus(box, fakeIo(new Set([boxPaths.wrapper]), 0));
  expect(there[0]).toBe(`restart-loop wrapper ${boxPaths.wrapper}: installed`);
  const gone = await serviceStatus(box, fakeIo(new Set(), 0));
  expect(gone[0]).toBe(`restart-loop wrapper ${boxPaths.wrapper}: not installed`);
});
