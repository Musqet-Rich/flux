import { expect, test } from 'vitest';

import { DaemonError } from '../daemon-error.ts';
import { runOrThrow } from './run-or-throw.ts';
import type { CommandResult, ServiceIo } from './service-io.ts';

const ioReturning = (result: CommandResult): ServiceIo => ({
  exists: () => false,
  writeFile: () => Promise.resolve(),
  removeFile: () => Promise.resolve(),
  mkdirp: () => Promise.resolve(),
  run: () => Promise.resolve(result),
});

test('runOrThrow resolves on a zero exit', async () => {
  await expect(
    runOrThrow(ioReturning({ code: 0, stdout: 'ok', stderr: '' }), ['systemctl', 'daemon-reload']),
  ).resolves.toBeUndefined();
});

test('runOrThrow reports stderr, then stdout, then the exit code', async () => {
  const argv = ['systemctl', 'enable', 'flux-daemon'];
  await expect(
    runOrThrow(ioReturning({ code: 1, stdout: 'out', stderr: '  boom  ' }), argv),
  ).rejects.toThrow('systemctl enable flux-daemon: boom');
  await expect(
    runOrThrow(ioReturning({ code: 1, stdout: '  fallback  ', stderr: '' }), argv),
  ).rejects.toThrow('systemctl enable flux-daemon: fallback');
  await expect(runOrThrow(ioReturning({ code: 5, stdout: '', stderr: '' }), argv)).rejects.toThrow(
    'systemctl enable flux-daemon: exit 5',
  );
  await expect(runOrThrow(ioReturning({ code: 5, stdout: '', stderr: '' }), argv)).rejects.toThrow(
    DaemonError,
  );
});
