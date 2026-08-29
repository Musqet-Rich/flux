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
  createdAt: '2026-01-01T00:00:00Z',
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
const device = { deviceId: 'd', pairedAt: '2026-01-01T00:00:00Z', current: true };
const settings = {
  flux: {
    reposDir: '/r',
    defaultAgent: 'claude',
    notifyOnAsk: true,
    notifyOnIdle: true,
    notifyOnDone: true,
  },
  env: { relayUrl: 'r', dataDir: 'd', daemonName: 'n', pushSubject: 'p', claudeCommand: 'c' },
  agent: { claudeMd: '', settingsJson: '{}' },
};

// One accepted and one rejected value per method; the table is the spec of protocol.md § 7.
const cases: { [M in RpcMethod]: [ok: unknown, bad: unknown] } = {
  hello: [
    {
      protocol: 1,
      daemon: 'd',
      sessions: [summary],
      vapidPublicKey: 'k',
      agents: ['claude', 'pi'],
    },
    { protocol: 1 },
  ],
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
  'sessions.unarchive': [{}, null],
  'sessions.clear': [{}, 'done'],
  'sessions.rename': [{}, 'x'],
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
  'git.commit': [{ sha: 'abc' }, { sha: 1 }],
  'git.push': [{ remote: 'origin', branch: 'b' }, { remote: 'origin' }],
  'git.pr': [{ url: 'https://x/pull/1' }, {}],
  'fs.read': [
    { ...content, hash: 'ab', truncated: true },
    { content: 1, binary: false },
  ],
  'fs.write': [{ hash: 'ab' }, { hash: 1 }],
  'fs.list': [{ entries: [{ name: 'a', kind: 'dir' }] }, { entries: [{ name: 'a', kind: 'x' }] }],
  'repos.list': [
    { repos: [{ path: '/r', name: 'r', branches: ['main'] }] },
    { repos: [{ path: '/r' }] },
  ],
  'pair.request': [{ deviceId: 'd' }, {}],
  'push.subscribe': [{}, false],
  'devices.list': [[device, { ...device, name: 'phone', lastSeenAt: 't' }], [{ deviceId: 'd' }]],
  'devices.remove': [{}, 0],
  'settings.get': [settings, { ...settings, agent: {} }],
  'settings.set': [settings, { flux: settings.flux }],
  'attach.begin': [{ attachmentId: 'a' }, {}],
  'attach.chunk': [{}, null],
  'attach.end': [{ path: '/d/a', size: 3 }, { path: '/d/a' }],
  'attach.read': [
    { data: 'AA==', size: 1, mime: 'image/png', name: 'a.png' },
    { data: 'AA==', size: 1, mime: 'image/png' },
  ],
  'attach.delete': [{}, 0],
};

test.each(Object.entries(cases))('%s result guard accepts and rejects', (method, [ok, bad]) => {
  const guard = rpcResults[method as RpcMethod];
  expect(guard(ok)).toBe(true);
  expect(guard(bad)).toBe(false);
});

// A page from a newer box may carry event types this build does not know (protocol.md § 8); the
// page must still be accepted or the session can never catch up.
test('events.sync accepts a page containing unknown event types', () => {
  const future = { ...event, seq: 2, type: 'msg.future', payload: { any: true } };
  expect(rpcResults['events.sync']({ events: [event, future], complete: true })).toBe(true);
});

test('optional fields may be present or absent, never wrong', () => {
  expect(rpcResults['git.show']({ ...content, hash: 1 })).toBe(false);
  expect(rpcResults['git.show']({ ...content, hash: null })).toBe(false);
  expect(rpcResults['fs.read']({ ...content, truncated: 'yes' })).toBe(false);
  expect(rpcResults['fs.read']({ ...content, truncated: 1 })).toBe(false);
  expect(rpcResults['fs.read']({ ...content, hash: 'ab' })).toBe(true);
  expect(rpcResults.hello({ protocol: 1, daemon: 'd', sessions: [] })).toBe(true);
  expect(rpcResults.hello({ protocol: 1, daemon: 'd', sessions: [], vapidPublicKey: 1 })).toBe(
    false,
  );
  expect(rpcResults.hello({ protocol: 1, daemon: 'd', sessions: [], agents: ['pi'] })).toBe(true);
  expect(rpcResults.hello({ protocol: 1, daemon: 'd', sessions: [], agents: ['gpt'] })).toBe(false);
  expect(rpcResults['git.status']({ files: [{ path: 'b', status: 'R', from: 'a' }] })).toBe(true);
  expect(rpcResults['git.status']({ files: [{ path: 'b', status: 'R', from: 1 }] })).toBe(false);
  expect(rpcResults['devices.list']([{ ...device, name: 1 }])).toBe(false);
  expect(rpcResults['devices.list']([{ ...device, lastSeenAt: 1 }])).toBe(false);
  expect(rpcResults['devices.list']([{ ...device, current: 'yes' }])).toBe(false);
  const { createdAt, ...older } = summary;
  expect(createdAt).toBeTypeOf('string');
  expect(rpcResults['sessions.list']([older])).toBe(true);
  expect(rpcResults['sessions.list']([{ ...summary, createdAt: 1 }])).toBe(false);
  expect(rpcResults['sessions.list']([{ ...summary, archived: true, worktreeExists: false }])).toBe(
    true,
  );
  expect(rpcResults['sessions.list']([{ ...summary, archived: 'yes' }])).toBe(false);
  expect(rpcResults['sessions.list']([{ ...summary, worktreeExists: 0 }])).toBe(false);
});
