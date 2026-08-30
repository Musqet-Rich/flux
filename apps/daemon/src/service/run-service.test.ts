import { expect, test } from 'vitest';

import { DaemonError } from '../daemon-error.ts';
import type { ServiceInput } from './build-service-config.ts';
import { runService } from './run-service.ts';
import type { CommandResult, ServiceIo } from './service-io.ts';

const input: ServiceInput = {
  platform: 'linux',
  hasSystemd: false,
  isRoot: false,
  user: 'node',
  home: '/home/node',
  node: '/usr/local/bin/node',
  entry: '/workspace/flux/apps/daemon/dist/index.mjs',
  dataDir: '/workspace/.flux',
  env: {},
};

const fakeIo = (present: Set<string>): { io: ServiceIo; writes: string[]; removes: string[] } => {
  const writes: string[] = [];
  const removes: string[] = [];
  const io: ServiceIo = {
    exists: (path) => present.has(path),
    writeFile: (path) => {
      writes.push(path);
      return Promise.resolve();
    },
    removeFile: (path) => {
      removes.push(path);
      return Promise.resolve();
    },
    mkdirp: () => Promise.resolve(),
    run: () => {
      const result: CommandResult = { code: 0, stdout: '', stderr: '' };
      return Promise.resolve(result);
    },
  };
  return { io, writes, removes };
};

test('dispatches install, uninstall and status to the resolved host', async () => {
  const install = fakeIo(new Set());
  await runService('install', { io: install.io, input });
  expect(install.writes).toEqual(['/workspace/.flux/flux-daemon-run.sh']);

  const uninstall = fakeIo(new Set(['/workspace/.flux/flux-daemon-run.sh']));
  await runService('uninstall', { io: uninstall.io, input });
  expect(uninstall.removes).toEqual(['/workspace/.flux/flux-daemon-run.sh']);

  const status = await runService('status', { io: fakeIo(new Set()).io, input });
  expect(status[0]).toContain('restart-loop wrapper');
});

test('an unknown subcommand rejects with a bad_params DaemonError', async () => {
  const { io } = fakeIo(new Set());
  await expect(runService('bogus', { io, input })).rejects.toThrow(DaemonError);
  await expect(runService(undefined, { io, input })).rejects.toThrow('install|uninstall|status');
});
