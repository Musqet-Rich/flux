import { expect, test } from 'vitest';

import type { RpcMethod } from './rpc-methods.ts';
import { rpcMethods } from './rpc-methods.ts';

const s = { session: 's' };
const ref = { path: 'a.ts', rev: 'worktree' };

const cases: [RpcMethod, unknown, boolean][] = [
  ['hello', { protocol: 1 }, true],
  ['hello', { protocol: 0 }, false],
  ['hello', {}, false],
  ['events.sync', { ...s, since: 0 }, true],
  ['events.sync', { ...s, since: -1 }, false],
  ['events.sync', { since: 0 }, false],
  ['sessions.list', {}, true],
  ['sessions.list', { extra: 1 }, false],
  ['sessions.list', null, false],
  ['sessions.cost', s, true],
  ['sessions.cost', { session: 1 }, false],
  ['sessions.create', { repo: '/r', branch: 'b', agent: 'claude' }, true],
  ['sessions.create', { repo: '/r', branch: 'b', agent: 'pi', base: 'main', title: 't' }, true],
  ['sessions.create', { repo: '/r', branch: 'b', agent: 'gpt' }, false],
  ['sessions.create', { repo: '/r', agent: 'claude' }, false],
  ['sessions.create', { repo: '/r', branch: 'b', agent: 'claude', base: 1 }, false],
  ['sessions.create', { repo: '/r', branch: 'b', agent: 'claude', title: 1 }, false],
  ['sessions.archive', s, true],
  ['sessions.restart', s, true],
  ['agent.send', { ...s, text: 'go' }, true],
  ['agent.send', { ...s, text: 'go', commentIds: ['c'] }, true],
  ['agent.send', { ...s, text: 'go', commentIds: 'c' }, false],
  ['agent.send', { ...s }, false],
  ['agent.answer', { ...s, askId: 'a', answer: 'y' }, true],
  ['agent.answer', { ...s, askId: 'a' }, false],
  ['agent.interrupt', s, true],
  ['comments.add', { ...s, ref, text: 't' }, true],
  ['comments.add', { ...s, ref: { ...ref, range: { startLine: 2, endLine: 2 } }, text: 't' }, true],
  [
    'comments.add',
    { ...s, ref: { ...ref, range: { startLine: 2, endLine: 1 } }, text: 't' },
    false,
  ],
  ['comments.add', { ...s, ref: { path: 'a' }, text: 't' }, false],
  ['comments.add', { ...s, ref, text: 1 }, false],
  ['comments.remove', { ...s, commentId: 'c' }, true],
  ['comments.remove', s, false],
  ['git.status', s, true],
  ['git.diff', s, true],
  ['git.diff', { ...s, path: 'a', from: 'x', to: 'y' }, true],
  ['git.diff', { ...s, path: 1 }, false],
  ['git.diff', { ...s, from: 1 }, false],
  ['git.diff', { ...s, to: 1 }, false],
  ['git.show', { ...s, path: 'a', rev: 'HEAD' }, true],
  ['git.show', { ...s, path: 'a' }, false],
  ['git.log', s, true],
  ['git.log', { ...s, limit: 10 }, true],
  ['git.log', { ...s, limit: 0 }, false],
  ['git.commit', { ...s, message: 'm' }, true],
  ['git.commit', { ...s, message: 'm', paths: ['a', 'b'] }, true],
  ['git.commit', { ...s, message: 'm', paths: 'a' }, false],
  ['git.commit', s, false],
  ['git.push', s, true],
  ['git.push', { ...s, setUpstream: true }, true],
  ['git.push', { ...s, setUpstream: 'yes' }, false],
  ['git.pr', { ...s, title: 't' }, true],
  ['git.pr', { ...s, title: 't', body: 'b', base: 'main', draft: true }, true],
  ['git.pr', { ...s, title: 't', body: 1 }, false],
  ['git.pr', { ...s, title: 't', base: 1 }, false],
  ['git.pr', { ...s, title: 't', draft: 'no' }, false],
  ['git.pr', s, false],
  ['fs.read', { ...s, path: 'a' }, true],
  ['fs.read', s, false],
  ['fs.write', { ...s, path: 'a', content: 'x' }, true],
  ['fs.write', { ...s, path: 'a', content: 'x', ifMatch: 'abc' }, true],
  ['fs.write', { ...s, path: 'a', content: 'x', ifMatch: 1 }, false],
  ['fs.write', { ...s, path: 'a', content: 'x', ifMatch: null }, false],
  ['fs.write', { ...s, path: 'a', content: 1 }, false],
  ['fs.write', { ...s, path: 'a' }, false],
  ['fs.write', { ...s, content: 'x' }, false],
  ['fs.list', { ...s, path: '.' }, true],
  ['fs.list', { ...s, path: 1 }, false],
  ['repos.list', {}, true],
  ['pair.request', { devPub: 'p', proof: 'q' }, true],
  ['pair.request', { devPub: 'p' }, false],
  ['push.subscribe', { subscription: { endpoint: 'https://x' } }, true],
  ['push.subscribe', { subscription: 'x' }, false],
];

test.each(cases)('%s params %j accepted=%s', (method, value, expected) => {
  expect(rpcMethods[method](value)).toBe(expected);
});

test('covers every method in protocol.md § 7 that is in P1', () => {
  expect(Object.keys(rpcMethods)).toHaveLength(25);
});
