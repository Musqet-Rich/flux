import type { Ephemeral } from '@flux/protocol';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { createShellRunner } from './create-shell-runner.ts';

// One end-to-end run on the REAL default spawn and clock (the unit tests in
// create-shell-runner.test.ts inject a fake process and timer): it proves the production
// `node:child_process` wrapper streams output and reports a clean exit, no mocking of the
// process boundary beyond a real `printf` (engineering.md § Testing).

type ShellOutput = Extract<Ephemeral, { type: 'shell.output' }>;
type ShellExited = Extract<Ephemeral, { type: 'shell.exited' }>;

const noop = (): void => {};

// The real child needs a PATH to find `sh`/`printf`; resolved here so the `??` stays out of a test.
const realPath = process.env['PATH'] ?? '';

const collect = (events: Ephemeral[], data: Ephemeral, onExit: () => void): void => {
  events.push(data);
  if (data.type === 'shell.exited') onExit();
};

const outputs = (events: Ephemeral[]): ShellOutput[] =>
  events.filter((e): e is ShellOutput => e.type === 'shell.output');
const exits = (events: Ephemeral[]): ShellExited[] =>
  events.filter((e): e is ShellExited => e.type === 'shell.exited');

test('runs a real command end to end on the default spawn and clock', async () => {
  const reposDir = await mkdtemp(join(tmpdir(), 'flux-shell-'));
  const events: Ephemeral[] = [];
  let settle: () => void = noop;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const runner = createShellRunner({
    reposDir,
    env: { PATH: realPath },
    emitEphemeral: (data) => {
      collect(events, data, settle);
    },
  });
  runner.run({ command: 'printf hello', deviceId: 'd1' });
  await done;
  expect(outputs(events)[0]?.chunk).toBe('hello');
  expect(exits(events)[0]).toEqual({
    type: 'shell.exited',
    runId: expect.any(String),
    code: 0,
    signal: null,
    truncated: false,
  });
});
