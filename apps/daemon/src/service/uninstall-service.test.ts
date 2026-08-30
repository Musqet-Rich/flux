import { expect, test } from 'vitest';

import type { ServiceConfig } from './build-service-config.ts';
import type { CommandResult, ServiceIo } from './service-io.ts';
import { servicePaths } from './service-paths.ts';
import { uninstallService } from './uninstall-service.ts';

interface Recorded {
  removes: string[];
  runs: string[][];
}

const fakeIo = (present: Set<string>): { io: ServiceIo; log: Recorded } => {
  const log: Recorded = { removes: [], runs: [] };
  const io: ServiceIo = {
    exists: (path) => present.has(path),
    writeFile: () => Promise.resolve(),
    removeFile: (path) => {
      log.removes.push(path);
      return Promise.resolve();
    },
    mkdirp: () => Promise.resolve(),
    run: (argv) => {
      log.runs.push([...argv]);
      const result: CommandResult = { code: 0, stdout: '', stderr: '' };
      return Promise.resolve(result);
    },
  };
  return { io, log };
};

const linux: ServiceConfig = {
  host: 'systemd',
  isRoot: true,
  user: 'flux',
  home: '/home/flux',
  node: '/usr/bin/node',
  entry: '/home/flux/flux/apps/daemon/dist/index.mjs',
  dataDir: '/home/flux/.flux',
  env: {},
};
const paths = servicePaths(linux);

test('systemd as root disables, removes the present unit and reloads', async () => {
  const { io, log } = fakeIo(new Set([paths.unit]));
  const lines = await uninstallService(linux, io);
  expect(log.runs).toEqual([
    ['systemctl', 'disable', '--now', 'flux-daemon'],
    ['systemctl', 'daemon-reload'],
  ]);
  expect(log.removes).toEqual([paths.unit]);
  expect(lines[0]).toContain(paths.unit);
});

test('systemd as root skips removing a unit that is not there', async () => {
  const { io, log } = fakeIo(new Set());
  await uninstallService(linux, io);
  expect(log.removes).toEqual([]);
});

test('systemd as non-root removes the staged unit and prints the sudo removal', async () => {
  const { io, log } = fakeIo(new Set([paths.staging]));
  const lines = await uninstallService({ ...linux, isRoot: false }, io);
  expect(log.removes).toEqual([paths.staging]);
  expect(log.runs).toEqual([]);
  expect(lines.join('\n')).toContain(`sudo rm -f ${paths.unit}`);
});

test('systemd as non-root with nothing staged removes nothing', async () => {
  const { io, log } = fakeIo(new Set());
  await uninstallService({ ...linux, isRoot: false }, io);
  expect(log.removes).toEqual([]);
});

test('launchd unloads and removes the present LaunchAgent', async () => {
  const mac: ServiceConfig = { ...linux, host: 'launchd', isRoot: false, home: '/Users/rich' };
  const macPaths = servicePaths(mac);
  const { io, log } = fakeIo(new Set([macPaths.launchAgent]));
  await uninstallService(mac, io);
  expect(log.runs).toEqual([['launchctl', 'unload', macPaths.launchAgent]]);
  expect(log.removes).toEqual([macPaths.launchAgent]);
});

test('launchd with no plist present removes nothing', async () => {
  const mac: ServiceConfig = { ...linux, host: 'launchd', isRoot: false, home: '/Users/rich' };
  const { io, log } = fakeIo(new Set());
  await uninstallService(mac, io);
  expect(log.removes).toEqual([]);
});

test('wrapper removes the script when present and not otherwise', async () => {
  const box: ServiceConfig = { ...linux, host: 'wrapper', isRoot: false };
  const boxPaths = servicePaths(box);
  const there = fakeIo(new Set([boxPaths.wrapper]));
  await uninstallService(box, there.io);
  expect(there.log.removes).toEqual([boxPaths.wrapper]);
  const gone = fakeIo(new Set());
  await uninstallService(box, gone.io);
  expect(gone.log.removes).toEqual([]);
});
