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

const noop = (): void => {};

// A box whose first page is held on the wire until `release`; later pages answer at once.
const heldFirstPage = (requests: number[], boxLog: FluxEvent[]) => {
  let release = noop;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const call = ((_method: unknown, params: unknown) => {
    const { since } = params as RpcMethods['events.sync']['params'];
    requests.push(since);
    const events = boxLog.filter((e) => e.seq > since);
    const held = requests.length === 1 ? gate : Promise.resolve();
    return held.then(() => ({ events, complete: true }));
  }) as never;
  return {
    call,
    release: (): void => {
      release();
    },
  };
};

// A concurrent sync shares the running pull and costs one extra page afterwards, since the
// pages already on the wire may predate whatever prompted it.
test('pages until complete and coalesces concurrent syncs of one session', async () => {
  const requests: number[] = [];
  const sync = syncSession(fakeCall(requests));
  const log = createSessionLog('s', [at(1)]);
  await Promise.all([sync(log), sync(log)]);
  expect(log.lastSeq()).toBe(5);
  expect(requests).toEqual([1, 3, 5]);
  await sync(log);
  expect(requests).toEqual([1, 3, 5, 5]);
});

// The box's log grows while a page is on the wire: the page answers with what the box had
// when it was asked, so a sync requested during that pull must pull again afterwards.
test('a sync requested during a pull runs once more after it, catching the newer events', async () => {
  const requests: number[] = [];
  const boxLog = [at(1), at(2)];
  const { call, release } = heldFirstPage(requests, boxLog);
  const sync = syncSession(call);
  const log = createSessionLog('s');
  const first = sync(log);
  boxLog.push(at(3));
  const second = sync(log);
  expect(second).toBe(first);
  release();
  await first;
  expect(log.lastSeq()).toBe(3);
  expect(requests).toEqual([0, 2]);
});
