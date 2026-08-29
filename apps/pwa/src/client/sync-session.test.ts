import type { FluxEvent, RpcMethods } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createSessionLog } from './create-session-log.ts';
import { syncSession } from './sync-session.ts';

const at = (seq: number): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's',
  type: 'msg.user',
  payload: { text: `m${seq}` },
});

const all = [1, 2, 3, 4, 5].map((n) => at(n));
const pageSize = 2;

const fakeCall = (requests: number[]) =>
  ((_method: unknown, params: unknown) => {
    const { since } = params as RpcMethods['events.sync']['params'];
    requests.push(since);
    const events = all.filter((e) => e.seq > since).slice(0, pageSize);
    const complete = events.length < pageSize || (events.at(-1)?.seq ?? 0) === 5;
    return Promise.resolve({ events, complete });
  }) as never;

test('pages until complete and coalesces concurrent syncs of one session', async () => {
  const requests: number[] = [];
  const sync = syncSession(fakeCall(requests));
  const log = createSessionLog('s', [at(1)]);
  await Promise.all([sync(log), sync(log)]);
  expect(log.lastSeq()).toBe(5);
  expect(requests).toEqual([1, 3]);
  await sync(log);
  expect(requests).toEqual([1, 3, 5]);
});
