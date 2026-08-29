import type { FluxEvent, SessionSummary } from '@flux/protocol';
import { pairing } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { Handlers } from '../../test/fake-relay.ts';
import { createFakeRelay } from '../../test/fake-relay.ts';
import { until } from '../../test/until.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { pairedBox } from '../client/paired-box.ts';
import { createStore } from './create-store.ts';

const summary = (session: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  session,
  title: session,
  repo: '/repos/r',
  branch: 'main',
  agent: 'claude',
  state: 'idle',
  lastSeq: 0,
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const ev = (seq: number, type: string, payload: unknown, session = 's1'): FluxEvent =>
  ({ seq, ts: '2026-01-01T00:00:00Z', session, type, payload }) as FluxEvent;

const boxLog: FluxEvent[] = [
  ev(1, 'session.created', {
    repo: '/repos/r',
    worktree: '/w',
    branch: 'main',
    base: 'abc',
    agent: 'claude',
  }),
  ev(2, 'msg.user', { text: 'hi' }),
];

const boxHandlers = (): Handlers => ({
  hello: () => ({
    protocol: 1,
    daemon: 'box',
    sessions: [summary('s1')],
    vapidPublicKey: 'a2V5',
  }),
  'events.sync': (p) => ({ events: boxLog.filter((e) => e.seq > p.since), complete: true }),
  'pair.request': () => ({ deviceId: 'dev-1' }),
  'agent.send': () => ({ seq: 9 }),
  'agent.answer': () => ({}),
  'comments.add': () => ({ commentId: 'c9' }),
  'comments.remove': () => ({}),
  'push.subscribe': () => ({}),
  'sessions.list': () => [summary('s1'), summary('s2')],
  'sessions.create': (p) => summary('s3', { branch: p.branch }),
});

// A box that does not know how to pair answers pair.request with not_found.
const setup = async (pairable = true) => {
  const handlers = boxHandlers();
  if (!pairable) delete handlers['pair.request'];
  const relay = await createFakeRelay(handlers);
  const storage = createMemoryStorage();
  const pushes: string[] = [];
  const another = () =>
    createStore({
      storage,
      socket: relay.socket,
      subscribePush: (key) => {
        pushes.push(key);
        return Promise.resolve({ endpoint: 'https://push.example/x' });
      },
      minBackoffMs: 1,
      maxBackoffMs: 5,
    });
  const link = (): string => {
    const secret = new Uint8Array(pairing.secretLength);
    return new URL(pairing.url('https://relay.example', { boxPub: relay.boxPub, secret })).hash;
  };
  const called = (method: string) => relay.calls.filter((c) => c.method === method);
  return { relay, store: another(), another, pushes, storage, link, called };
};

test('boots to the pair screen without a stored box, and calls are refused', async () => {
  const { store } = await setup();
  await store.boot();
  expect(store.state.phase).toBe('unpaired');
  await expect(store.call('sessions.list', {})).rejects.toMatchObject({ code: 'offline' });
  await expect(store.send('s1', 'x')).rejects.toMatchObject({ code: 'offline' });
});

test('pairs from a link, says hello, subscribes to push and remembers the box', async () => {
  const { store, storage, link, pushes, called } = await setup();
  await store.pair('https://relay.example', link());
  expect(store.state.phase).toBe('paired');
  expect(store.state.status).toBe('connected');
  expect(store.state.daemon).toBe('box');
  expect(store.state.sessions).toEqual([summary('s1')]);
  expect(pushes).toEqual(['a2V5']);
  expect(called('push.subscribe')[0]?.params).toEqual({
    subscription: { endpoint: 'https://push.example/x' },
  });
  expect(await pairedBox.load(await storage.get(pairedBox.storageKey))).not.toBeNull();
  store.stop();
  expect(store.state.status).toBe('stopped');
});

test('a bad link or a refused pairing lands back on the pair screen with the reason', async () => {
  const { store, link, relay } = await setup(false);
  await store.pair('https://relay.example', '#nope');
  expect(store.state).toMatchObject({ phase: 'unpaired', error: 'not a pairing link' });
  await store.pair('https://relay.example', link());
  expect(store.state).toMatchObject({ phase: 'unpaired', error: 'no pair.request' });
  expect(store.state.status).toBe('stopped');
  expect(relay.guests()).toBe(0);
});

test('opens a session from the cache, syncs it, then applies live events and deltas', async () => {
  const { store, storage, link, relay } = await setup();
  await storage.set('log:s1', [boxLog[0]]);
  await storage.set('log:s2', 'garbage');
  await store.pair('https://relay.example', link());
  await store.open('s1');
  await store.open('s2');
  expect(store.state.logs['s1']?.events).toEqual(boxLog);
  expect(store.state.logs['s2']?.events).toEqual([]);
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 3, text: 'wor' });
  await until(() => store.state.logs['s1']?.streaming === 'wor');
  const reply = ev(3, 'msg.assistant', { text: 'world' });
  await relay.emit(reply);
  await until(() => store.state.logs['s1']?.lastSeq === 3);
  expect(store.state.logs['s1']).toMatchObject({ streaming: '', events: [...boxLog, reply] });
  expect(await storage.get('log:s1')).toEqual([...boxLog, reply]);
  expect(store.state.sessions[0]).toMatchObject({ lastSeq: 3 });
});

test('a gap in seq triggers a sync instead of applying the event', async () => {
  const { store, link, relay, called } = await setup();
  await store.pair('https://relay.example', link());
  await store.open('s1');
  const syncsBefore = called('events.sync').length;
  boxLog.push(ev(3, 'msg.assistant', { text: 'late' }));
  await relay.emit(ev(4, 'session.state', { state: 'idle' }));
  await until(() => store.state.logs['s1']?.lastSeq === 3);
  expect(called('events.sync').length).toBe(syncsBefore + 1);
  boxLog.pop();
});

test('sends messages with pending comments, answers asks, adds and removes comments', async () => {
  const { store, link, relay, called } = await setup();
  await store.pair('https://relay.example', link());
  await store.open('s1');
  const ref = { path: 'a.ts', rev: 'worktree', range: { startLine: 1, endLine: 2 } };
  await store.addComment('s1', ref, 'fix');
  expect(called('comments.add')[0]?.params).toEqual({ session: 's1', ref, text: 'fix' });
  await relay.emit(ev(3, 'comment.added', { commentId: 'c1', ref, text: 'fix' }));
  await relay.emit(ev(4, 'comment.added', { commentId: 'c2', ref, text: 'gone' }));
  await relay.emit(ev(5, 'comment.removed', { commentId: 'c2' }));
  await until(() => store.state.logs['s1']?.lastSeq === 5);
  await store.send('s1', 'please');
  expect(called('agent.send')[0]?.params).toEqual({
    session: 's1',
    text: 'please',
    commentIds: ['c1'],
  });
  await relay.emit(ev(6, 'comment.sent', { commentIds: ['c1'], msgSeq: 9 }));
  await until(() => store.state.logs['s1']?.lastSeq === 6);
  await store.send('s1', 'again');
  expect(called('agent.send')[1]?.params).toEqual({ session: 's1', text: 'again' });
  await store.answer('s1', 'ask-1', 'yes');
  expect(called('agent.answer')[0]?.params).toEqual({
    session: 's1',
    askId: 'ask-1',
    answer: 'yes',
  });
  await store.removeComment('s1', 'c1');
  expect(called('comments.remove')[0]?.params).toEqual({ session: 's1', commentId: 'c1' });
});

test('tracks sessions: state patches, unknown sessions refresh the list, creation adds', async () => {
  const { store, link, relay } = await setup();
  await store.pair('https://relay.example', link());
  await relay.emit(ev(1, 'session.state', { state: 'running' }));
  await until(() => store.state.sessions[0]?.state === 'running');
  await relay.emit(ev(1, 'session.renamed', { title: 'Renamed' }));
  await until(() => store.state.sessions[0]?.title === 'Renamed');
  await relay.emit(ev(1, 'session.created', boxLog[0]?.payload, 's2'));
  await until(() => store.state.sessions.length === 2);
  const windows = [{ name: '5h', utilisation: 0.5, resetsAt: '2026-01-01T05:00:00Z' }];
  await relay.emit(ev(2, 'rate_limit', { windows }, 's2'));
  await until(() => store.state.rateWindows.length === 1);
  expect(store.state.rateWindows).toEqual(windows);
  const created = await store.createSession({ repo: '/repos/r', branch: 'b', agent: 'claude' });
  expect(created.branch).toBe('b');
  expect(store.state.sessions.map((s) => s.session)).toEqual(['s1', 's2', 's3']);
  await store.refreshSessions();
  expect(store.state.sessions.map((s) => s.session)).toEqual(['s1', 's2']);
});

test('boots from the stored box, renders the cache, and re-syncs after a reconnect', async () => {
  const first = await setup();
  await first.store.pair('https://relay.example', first.link());
  await first.store.open('s1');
  first.store.stop();
  const { relay, called } = first;
  const store = first.another();
  await store.boot();
  expect(store.state.phase).toBe('paired');
  await store.open('s1');
  expect(store.state.logs['s1']?.events).toEqual(boxLog);
  await until(() => store.state.daemon === 'box');
  expect(called('hello').length).toBe(2);
  // The box logs something while the device is away; the reconnect's sync must pick it up.
  const missed = ev(3, 'msg.assistant', { text: 'while you were out' });
  boxLog.push(missed);
  relay.dropGuests();
  await until(() => store.state.status !== 'connected');
  await until(() => store.state.logs['s1']?.lastSeq === 3);
  boxLog.pop();
  expect(store.state.status).toBe('connected');
  expect(called('hello').length).toBe(3);
  store.stop();
});
