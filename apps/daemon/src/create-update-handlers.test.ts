import { expect, test } from 'vitest';

import type { RpcMethods } from '@flux/protocol';

import type { Peer } from './create-device-channels.ts';
import { createUpdateHandlers } from './create-update-handlers.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext, UpdateService } from './handler-context.ts';

const peer = {} as unknown as Peer;

type CheckResult = RpcMethods['daemon.checkUpdate']['result'];
const idleCheck: CheckResult = {
  current: '1.0.0',
  latest: null,
  available: false,
  verified: null,
  reason: 'unreachable',
};

interface Fixture {
  update: UpdateService;
  calls: string[];
}

const fixture = (over: Partial<UpdateService>): Fixture => {
  const calls: string[] = [];
  const update: UpdateService = {
    currentVersion: '1.0.0',
    distDir: '/opt/flux/dist',
    apply: (target) => {
      calls.push(target);
    },
    check: () => Promise.resolve(idleCheck),
    ...over,
  };
  return { update, calls };
};

// The handler validates synchronously (the router wraps the call in try/catch); resolve first so
// a refusal surfaces as a rejected promise for `.rejects`, exactly as the awaited router sees it.
const run = (update: UpdateService, target: string): Promise<Record<string, never>> =>
  Promise.resolve().then(() =>
    createUpdateHandlers({ update } as unknown as HandlerContext)['daemon.update'](
      { version: target },
      peer,
    ),
  );

test('a valid newer target returns {} at once and kicks off the update', async () => {
  const { update, calls } = fixture({ currentVersion: '1.0.0' });
  await expect(run(update, '1.2.0')).resolves.toEqual({});
  expect(calls).toEqual(['1.2.0']);
});

test('a dev build (no dist dir) is refused as unsupported and starts nothing', async () => {
  const { update, calls } = fixture({ distDir: null, currentVersion: '0.0.0-dev' });
  await expect(run(update, '1.2.0')).rejects.toBeInstanceOf(DaemonError);
  await expect(run(update, '1.2.0')).rejects.toMatchObject({ code: 'unsupported' });
  expect(calls).toEqual([]);
});

test('a target that is not newer than the running build is refused', async () => {
  const { update, calls } = fixture({ currentVersion: '2.0.0' });
  await expect(run(update, '2.0.0')).rejects.toMatchObject({ code: 'unsupported' });
  await expect(run(update, '1.5.0')).rejects.toMatchObject({ code: 'unsupported' });
  expect(calls).toEqual([]);
});

test('a target that is not valid semver is refused', async () => {
  const { update, calls } = fixture({});
  await expect(run(update, 'not-a-version')).rejects.toMatchObject({ code: 'unsupported' });
  expect(calls).toEqual([]);
});

test('a target below the 1.0.0 floor is refused even when newer', async () => {
  const { update, calls } = fixture({ currentVersion: '0.5.0' });
  await expect(run(update, '0.9.0')).rejects.toMatchObject({ code: 'unsupported' });
  expect(calls).toEqual([]);
});

test('checkUpdate delegates to the update service and returns its result', async () => {
  const available: CheckResult = {
    current: '1.0.0',
    latest: '1.2.0',
    available: true,
    verified: true,
  };
  const update: UpdateService = { ...fixture({}).update, check: () => Promise.resolve(available) };
  const handlers = createUpdateHandlers({ update } as unknown as HandlerContext);
  await expect(handlers['daemon.checkUpdate']({}, peer)).resolves.toEqual(available);
});
