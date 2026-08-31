import { expect, test } from 'vitest';

import type { Peer } from './create-device-channels.ts';
import { createShellHandlers } from './create-shell-handlers.ts';
import type { ShellRunner } from './create-shell-runner.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';

// The two command-runner handlers key every call to the caller's device (ADR 0026), so a run and
// its interrupt can only ever touch that device's own run. The runner itself is faked; its own
// behaviour is covered in create-shell-runner.test.ts.

interface Spy {
  runs: { command: string; cwd?: string; deviceId: string }[];
  interrupts: { runId: string; deviceId: string }[];
}

const fakeShell = (overrides: Partial<ShellRunner> = {}): { shell: ShellRunner; spy: Spy } => {
  const spy: Spy = { runs: [], interrupts: [] };
  const shell: ShellRunner = {
    run: (params) => {
      spy.runs.push(params);
      return { runId: 'run-1' };
    },
    interrupt: (params) => {
      spy.interrupts.push(params);
    },
    disconnect: () => {},
    stopAll: () => {},
    ...overrides,
  };
  return { shell, spy };
};

const peer = (deviceId: string | null): Peer =>
  ({
    fingerprint: 'fp',
    publicKey: new Uint8Array(),
    device: deviceId === null ? null : { deviceId, pairedAt: '2026-01-01T00:00:00Z' },
  }) as Peer;

const handlers = (shell: ShellRunner) =>
  createShellHandlers({ shell } as unknown as HandlerContext);

test('shell.run forwards command, cwd and the caller device, returning the runId', async () => {
  const { shell, spy } = fakeShell();
  const result = await handlers(shell)['shell.run']({ command: 'ls', cwd: 'sub' }, peer('d1'));
  expect(result).toEqual({ runId: 'run-1' });
  expect(spy.runs).toEqual([{ command: 'ls', cwd: 'sub', deviceId: 'd1' }]);
});

test('shell.run omits cwd when the device did not send one', async () => {
  const { shell, spy } = fakeShell();
  await handlers(shell)['shell.run']({ command: 'ls' }, peer('d1'));
  // `toEqual` is exact, so an absent `cwd` key is asserted by its omission here.
  expect(spy.runs[0]).toEqual({ command: 'ls', deviceId: 'd1' });
});

test('shell.interrupt forwards the runId and the caller device', async () => {
  const { shell, spy } = fakeShell();
  const result = await handlers(shell)['shell.interrupt']({ runId: 'run-1' }, peer('d2'));
  expect(result).toEqual({});
  expect(spy.interrupts).toEqual([{ runId: 'run-1', deviceId: 'd2' }]);
});

test('a runner refusal (conflict) propagates as its error', () => {
  const { shell } = fakeShell({
    run: () => {
      throw new DaemonError('conflict', 'a command is already running on this device');
    },
  });
  expect(() => handlers(shell)['shell.run']({ command: 'ls' }, peer('d1'))).toThrow(
    /already running/u,
  );
});

test('an unpaired peer is refused (the defensive floor below the router’s pairing gate)', () => {
  const { shell } = fakeShell();
  expect(() => handlers(shell)['shell.run']({ command: 'ls' }, peer(null))).toThrow(
    /pair this device/u,
  );
  expect(() => handlers(shell)['shell.interrupt']({ runId: 'r' }, peer(null))).toThrow(DaemonError);
});
