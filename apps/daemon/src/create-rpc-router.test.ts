import type { Wire } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { Peer } from './create-device-channels.ts';
import type { RpcHandlers } from './create-rpc-router.ts';
import { createRpcRouter } from './create-rpc-router.ts';
import { DaemonError } from './daemon-error.ts';

const paired: Peer = {
  fingerprint: 'ff',
  publicKey: new Uint8Array(32),
  device: { deviceId: 'd1', publicKey: new Uint8Array(32), name: 'n', pairedAt: 't' },
};
const stranger: Peer = { fingerprint: 'ee', publicKey: new Uint8Array(32), device: null };

const summary = {
  session: 's',
  title: 't',
  repo: '/r',
  branch: 'b',
  agent: 'claude' as const,
  state: 'idle' as const,
  lastSeq: 0,
  updatedAt: 'now',
};

const unimplemented = (): Promise<never> => Promise.reject(new Error('unimplemented'));

const handlers: RpcHandlers = {
  hello: () => Promise.resolve({ protocol: 1, daemon: 'test', sessions: [] }),
  'events.sync': () => Promise.resolve({ events: [], complete: true }),
  'sessions.list': () => Promise.resolve([summary]),
  'sessions.cost': () => Promise.reject(new DaemonError('not_found', 'no session')),
  'sessions.create': unimplemented,
  'sessions.archive': unimplemented,
  'sessions.restart': unimplemented,
  'agent.send': (params) => Promise.resolve({ seq: params.text.length }),
  'agent.answer': unimplemented,
  'agent.interrupt': unimplemented,
  'comments.add': unimplemented,
  'comments.remove': unimplemented,
  'git.status': unimplemented,
  'git.diff': unimplemented,
  'git.show': unimplemented,
  'git.log': unimplemented,
  'fs.read': unimplemented,
  'fs.list': unimplemented,
  'repos.list': unimplemented,
  'pair.request': (_params, peer) => Promise.resolve({ deviceId: `new-${peer.fingerprint}` }),
  'push.subscribe': unimplemented,
};

const router = createRpcRouter(handlers);
const rpc = (method: string, params: unknown, id = '1'): Wire => ({
  kind: 'rpc',
  id,
  method,
  params,
});

test('routes a valid call and returns its result', async () => {
  expect(await router(paired, rpc('sessions.list', {}))).toEqual({
    kind: 'rpc.result',
    id: '1',
    ok: true,
    result: [summary],
  });
  expect(await router(paired, rpc('agent.send', { session: 's', text: 'abc' }, '7'))).toEqual({
    kind: 'rpc.result',
    id: '7',
    ok: true,
    result: { seq: 3 },
  });
});

test('rejects bad params, unknown methods and unpaired callers', async () => {
  expect(await router(paired, rpc('agent.send', { session: 's' }))).toMatchObject({
    ok: false,
    error: { code: 'bad_params' },
  });
  expect(await router(paired, rpc('nope.method', {}))).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  });
  expect(await router(stranger, rpc('sessions.list', {}))).toMatchObject({
    ok: false,
    error: { code: 'not_paired' },
  });
  expect(await router(stranger, rpc('pair.request', { devPub: 'p', proof: 'q' }))).toEqual({
    kind: 'rpc.result',
    id: '1',
    ok: true,
    result: { deviceId: 'new-ee' },
  });
});

test('handler errors become RpcError results', async () => {
  expect(await router(paired, rpc('sessions.cost', { session: 's' }))).toEqual({
    kind: 'rpc.result',
    id: '1',
    ok: false,
    error: { code: 'not_found', message: 'no session' },
  });
  expect(await router(paired, rpc('repos.list', {}))).toEqual({
    kind: 'rpc.result',
    id: '1',
    ok: false,
    error: { code: 'internal', message: 'unimplemented' },
  });
});

test('non-rpc messages produce no reply', async () => {
  const ephemeral: Wire = {
    kind: 'ephemeral',
    data: { type: 'typing', session: 's', deviceId: 'd' },
  };
  expect(await router(paired, ephemeral)).toBeNull();
});
