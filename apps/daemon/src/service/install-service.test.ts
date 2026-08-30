import { dirname } from 'node:path';
import { expect, test } from 'vitest';

import { DaemonError } from '../daemon-error.ts';
import type { ServiceConfig } from './build-service-config.ts';
import { installService } from './install-service.ts';
import type { CommandResult, ServiceIo } from './service-io.ts';
import { servicePaths } from './service-paths.ts';

interface Recorded {
  writes: { path: string; content: string; mode: number }[];
  removes: string[];
  mkdirs: string[];
  runs: string[][];
}

const fakeIo = (
  present: Set<string>,
  results: Map<string, CommandResult>,
): { io: ServiceIo; log: Recorded } => {
  const log: Recorded = { writes: [], removes: [], mkdirs: [], runs: [] };
  const io: ServiceIo = {
    exists: (path) => present.has(path),
    writeFile: (path, content, mode) => {
      log.writes.push({ path, content, mode });
      return Promise.resolve();
    },
    removeFile: (path) => {
      log.removes.push(path);
      return Promise.resolve();
    },
    mkdirp: (path) => {
      log.mkdirs.push(path);
      return Promise.resolve();
    },
    run: (argv) => {
      log.runs.push([...argv]);
      return Promise.resolve(results.get(argv.join(' ')) ?? { code: 0, stdout: '', stderr: '' });
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
  env: { FLUX_RELAY_URL: 'https://flux.example.com' },
};
const paths = servicePaths(linux);

test('systemd as root writes the system unit and enables it now', async () => {
  const { io, log } = fakeIo(new Set(), new Map());
  const lines = await installService(linux, io);
  expect(log.writes).toEqual([
    { path: paths.unit, content: expect.stringContaining('ExecStart='), mode: 0o644 },
  ]);
  expect(log.runs).toEqual([
    ['systemctl', 'daemon-reload'],
    ['systemctl', 'enable', '--now', 'flux-daemon'],
  ]);
  expect(lines[0]).toContain(paths.unit);
});

test('systemd as non-root stages the unit and prints the sudo commands', async () => {
  const { io, log } = fakeIo(new Set(), new Map());
  const lines = await installService({ ...linux, isRoot: false }, io);
  expect(log.mkdirs).toEqual([dirname(paths.staging)]);
  expect(log.writes).toEqual([
    { path: paths.staging, content: expect.stringContaining('ExecStart='), mode: 0o644 },
  ]);
  expect(log.runs).toEqual([]);
  expect(lines.join('\n')).toContain(`sudo cp ${paths.staging} ${paths.unit}`);
});

test('a failing systemctl step is a DaemonError', async () => {
  const results = new Map<string, CommandResult>([
    ['systemctl enable --now flux-daemon', { code: 1, stdout: '', stderr: 'unit not found' }],
  ]);
  const { io } = fakeIo(new Set(), results);
  await expect(installService(linux, io)).rejects.toThrow(DaemonError);
  await expect(installService(linux, io)).rejects.toThrow('unit not found');
});

test('launchd writes the LaunchAgent, reloads a stale copy and loads it', async () => {
  const mac: ServiceConfig = { ...linux, host: 'launchd', isRoot: false, home: '/Users/rich' };
  const macPaths = servicePaths(mac);
  const { io, log } = fakeIo(new Set(), new Map());
  const lines = await installService(mac, io);
  expect(log.mkdirs).toEqual([dirname(macPaths.launchAgent)]);
  expect(log.writes[0]?.path).toBe(macPaths.launchAgent);
  expect(log.runs).toEqual([
    ['launchctl', 'unload', macPaths.launchAgent],
    ['launchctl', 'load', '-w', macPaths.launchAgent],
  ]);
  expect(lines.join('\n')).toContain('root LaunchDaemon');
});

test('the no-init wrapper is written executable with run instructions', async () => {
  const box: ServiceConfig = { ...linux, host: 'wrapper', isRoot: false };
  const boxPaths = servicePaths(box);
  const { io, log } = fakeIo(new Set(), new Map());
  const lines = await installService(box, io);
  expect(log.writes).toEqual([
    { path: boxPaths.wrapper, content: expect.stringContaining('while true'), mode: 0o755 },
  ]);
  expect(log.runs).toEqual([]);
  expect(lines.join('\n')).toContain('nohup');
});
