import type { Wire } from '@flux/protocol';
import { expect, test } from 'vitest';

import { ClientError } from './client-error.ts';
import { createRpcClient } from './create-rpc-client.ts';

const setup = (timeoutMs?: number) => {
  const sent: Wire[] = [];
  const options = timeoutMs === undefined ? {} : { timeoutMs };
  const client = createRpcClient({
    send: (m) => {
      sent.push(m);
    },
    ...options,
  });
  const lastId = (): string => {
    const last = sent.at(-1);
    return last?.kind === 'rpc' ? last.id : '';
  };
  return { sent, client, lastId };
};

test('resolves a call with the matching result and rejects with the box error', async () => {
  const { sent, client, lastId } = setup();
  const ok = client.call('sessions.list', {});
  expect(sent[0]).toMatchObject({ kind: 'rpc', method: 'sessions.list', params: {} });
  expect(client.receive({ kind: 'rpc.result', id: lastId(), ok: true, result: [] })).toBe(true);
  expect(await ok).toEqual([]);
  const bad = client.call('sessions.archive', { session: 'nope' });
  client.receive({
    kind: 'rpc.result',
    id: lastId(),
    ok: false,
    error: { code: 'not_found', message: 'no such session' },
  });
  await expect(bad).rejects.toMatchObject({ code: 'not_found', message: 'no such session' });
  expect(client.pending()).toBe(0);
});

test('a result that fails its guard is a bad_reply', async () => {
  const { client, lastId } = setup();
  const call = client.call('agent.send', { session: 's', text: 'hi' });
  client.receive({ kind: 'rpc.result', id: lastId(), ok: true, result: { seq: 'one' } });
  await expect(call).rejects.toMatchObject({ code: 'bad_reply' });
});

test('ignores results for unknown ids and non-result messages', () => {
  const { client } = setup();
  expect(client.receive({ kind: 'rpc.result', id: 'x', ok: true, result: 1 })).toBe(false);
  expect(
    client.receive({
      kind: 'ephemeral',
      data: { type: 'delta', session: 's', forSeq: 1, text: '' },
    }),
  ).toBe(false);
});

test('rejectAll fails every call in flight; a timeout fails one', async () => {
  const { client } = setup(20);
  const a = client.call('sessions.list', {});
  const b = client.call('repos.list', {});
  client.rejectAll(new ClientError('offline', 'socket closed'));
  await expect(a).rejects.toMatchObject({ code: 'offline' });
  await expect(b).rejects.toMatchObject({ code: 'offline' });
  await expect(client.call('sessions.list', {})).rejects.toMatchObject({ code: 'timeout' });
});
