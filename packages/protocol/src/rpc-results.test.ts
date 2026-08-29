import { expect, test } from 'vitest';

import type { RpcMethod } from './rpc-methods.ts';
import { rpcResults } from './rpc-results.ts';

const summary = {
  session: 's1',
  title: 'T',
  repo: '/r',
  branch: 'main',
  agent: 'claude',
  state: 'idle',
  lastSeq: 0,
  updatedAt: '2026-01-01T00:00:00Z',
};
const usage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
const event = {
  seq: 1,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type: 'msg.user',
  payload: { text: 'hi' },
};
const content = { content: 'x', binary: false };

// One accepted and one rejected value per method; the table is the spec of protocol.md § 7.
const cases: { [M in RpcMethod]: [ok: unknown, bad: unknown] } = {
  hello: [{ protocol: 1, daemon: 'd', sessions: [summary], vapidPublicKey: 'k' }, { protocol: 1 }],
  'events.sync': [
    { events: [event], complete: true },
    { events: [{}], complete: true },
  ],
  'sessions.list': [[summary], [{ ...summary, state: 'busy' }]],
  'sessions.cost': [
    { costUsd: 0.1, usage, turns: 2 },
    { costUsd: 0.1, usage: {}, turns: 2 },
  ],
  'sessions.create': [summary, { ...summary, lastSeq: -1 }],
  'sessions.archive': [{}, null],
  'sessions.restart': [{}, 'ok'],
  'agent.send': [{ seq: 3 }, { seq: 0 }],
  'agent.answer': [{}, []],
  'agent.interrupt': [{}, 1],
  'comments.add': [{ commentId: 'c' }, { commentId: 1 }],
  'comments.remove': [{}, undefined],
  'git.status': [{ files: [{ path: 'a', status: 'M' }] }, { files: [{ path: 'a', status: 'X' }] }],
  'git.diff': [{ diff: '' }, { diff: null }],
  'git.show': [content, { content: 'x' }],
  'git.log': [{ commits: [{ sha: 'a', subject: 's', author: 'me', ts: 't' }] }, { commits: [{}] }],
  'fs.read': [content, { content: 1, binary: false }],
  'fs.list': [{ entries: [{ name: 'a', kind: 'dir' }] }, { entries: [{ name: 'a', kind: 'x' }] }],
  'repos.list': [
    { repos: [{ path: '/r', name: 'r', branches: ['main'] }] },
    { repos: [{ path: '/r' }] },
  ],
  'pair.request': [{ deviceId: 'd' }, {}],
  'push.subscribe': [{}, false],
};

test.each(Object.entries(cases))('%s result guard accepts and rejects', (method, [ok, bad]) => {
  const guard = rpcResults[method as RpcMethod];
  expect(guard(ok)).toBe(true);
  expect(guard(bad)).toBe(false);
});

test('optional fields may be present or absent, never wrong', () => {
  expect(rpcResults.hello({ protocol: 1, daemon: 'd', sessions: [] })).toBe(true);
  expect(rpcResults.hello({ protocol: 1, daemon: 'd', sessions: [], vapidPublicKey: 1 })).toBe(
    false,
  );
  expect(rpcResults['git.status']({ files: [{ path: 'b', status: 'R', from: 'a' }] })).toBe(true);
  expect(rpcResults['git.status']({ files: [{ path: 'b', status: 'R', from: 1 }] })).toBe(false);
});
