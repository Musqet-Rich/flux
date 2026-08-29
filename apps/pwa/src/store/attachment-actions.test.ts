import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { base64 } from '../client/base64.ts';
import { ClientError } from '../client/client-error.ts';

const image = { id: 'img-1', name: 'shot.png', mime: 'image/png', size: 3, image: true };
const file = { id: 'f-1', name: 'a.txt', mime: 'text/plain', size: 3, image: false };
const row = (seq: number, type: string, payload: unknown): FluxEvent => ({
  seq,
  ts: 't',
  session: 's1',
  type,
  payload,
});
const sent = [
  row(1, 'msg.user', { text: 'see', attachments: [image, file] }),
  row(2, 'msg.assistant', { text: 'ok' }),
  row(3, 'msg.user', { text: 'again', attachments: [image] }),
];

// The composer's files against a fake box that stores them (ADR 0020): an added file uploads
// at once, a ready one goes with the next message, a removed one is deleted on the box, and
// thumbnails come back through attach.read as blob URLs until the session is left.

const png = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'shot.png', {
  type: 'image/png',
});
const txt = new File(['hello'], 'notes.txt', { type: 'text/plain' });

// A box that keeps every uploaded byte, refusing what `refuse` names.
const box = (refuse: string[] = []) => {
  const stored = new Map<string, Uint8Array[]>();
  let next = 0;
  const refusing = (method: string): void => {
    if (refuse.includes(method)) throw new ClientError('internal', `${method} refused`);
  };
  return pairedStore([], {
    'attach.begin': () => {
      refusing('attach.begin');
      next += 1;
      stored.set(`att-${next}`, []);
      return { attachmentId: `att-${next}` };
    },
    'attach.chunk': (p) => {
      stored.get(p.attachmentId)?.push(base64.decode(p.data));
      return {};
    },
    'attach.end': (p) => {
      refusing('attach.end');
      return { path: `/box/${p.attachmentId}`, size: 0 };
    },
    'attach.delete': () => ({}),
    'attach.read': (p) => ({
      data: base64.encode(new Uint8Array([1, 2, 3]).subarray(p.offset)),
      size: 3,
      mime: 'image/png',
      name: 'shot.png',
    }),
    'agent.send': () => ({ seq: 9 }),
  }).then((paired) => ({ ...paired, stored }));
};

test('an added file uploads at once and goes with the next message; the draft then clears', async () => {
  const { store, calls, stored } = await box();
  store.composer('s1').text = 'look';
  store.attach('s1', [png, txt]);
  const draft = store.composer('s1');
  expect(draft.attachments.map((a) => [a.name, a.image, a.status])).toEqual([
    ['shot.png', true, 'uploading'],
    ['notes.txt', false, 'uploading'],
  ]);
  expect(draft.attachments[0]?.preview).toMatch(/^blob:/u);
  expect(draft.attachments[1]?.preview).toBeNull();
  await until(() => draft.attachments.every((a) => a.status === 'ready'));
  expect(draft.attachments.map((a) => [a.id, a.progress])).toEqual([
    ['att-1', 1],
    ['att-2', 1],
  ]);
  expect(new TextDecoder().decode(stored.get('att-2')?.[0])).toBe('hello');
  expect(await store.send('s1', 'look')).toBe(true);
  expect(calls('agent.send')).toEqual([
    { session: 's1', text: 'look', attachments: ['att-1', 'att-2'] },
  ]);
  expect(store.composer('s1')).toEqual({ text: '', attachments: [] });
  store.stop();
});

test('a removed attachment is deleted on the box; a failed one can be retried', async () => {
  const { store, calls } = await box(['attach.end']);
  store.attach('s1', [txt]);
  const draft = store.composer('s1');
  await until(() => draft.attachments[0]?.status === 'failed');
  expect(draft.attachments[0]?.error).toBe('attach.end refused');
  await until(() => calls('attach.delete').length === 1);
  expect(calls('attach.delete')).toEqual([{ attachmentId: 'att-1' }]);
  const key = String(draft.attachments.map((a) => a.key)[0]);
  store.retryAttachment('s1', key);
  await until(() => calls('attach.begin').length === 2);
  await until(() => draft.attachments[0]?.status === 'failed');
  await until(() => calls('attach.delete').length === 2);
  store.removeAttachment('s1', key);
  expect(draft.attachments).toEqual([]);
  store.removeAttachment('s1', key);
  store.retryAttachment('s1', 'nope');
  expect(await store.send('s1', 'go')).toBe(true);
  expect(calls('agent.send')).toEqual([{ session: 's1', text: 'go' }]);
  expect(calls('attach.delete')).toHaveLength(2);
  store.stop();
});

test('a ready attachment removed before sending is deleted on the box', async () => {
  const { store, calls } = await box();
  store.attach('s1', [txt]);
  const draft = store.composer('s1');
  await until(() => draft.attachments[0]?.status === 'ready');
  store.removeAttachment('s1', String(draft.attachments.map((a) => a.key)[0]));
  await until(() => calls('attach.delete').length === 1);
  expect(calls('attach.delete')).toEqual([{ attachmentId: 'att-1' }]);
  store.stop();
});

test('thumbnails are fetched once per image and dropped on leave', async () => {
  const { store, calls } = await box();
  store.loadThumbnails('s1', sent);
  store.loadThumbnails('s1', sent);
  await until(() => store.state.thumbs['img-1'] !== undefined);
  expect(store.state.thumbs['img-1']).toMatch(/^blob:/u);
  expect(calls('attach.read')).toEqual([{ attachmentId: 'img-1', offset: 0, length: 512 * 1024 }]);
  store.leave('s1');
  expect(store.state.thumbs).toEqual({});
  store.leave('s1');
  store.stop();
});

// One turn of the event loop, without a timer: the refusal comes back through the fake
// relay's asynchronous seal, which microtasks alone would starve.
const turn = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.addEventListener('message', () => {
      channel.port1.close();
      resolve();
    });
    channel.port1.start();
    channel.port2.postMessage(null);
  });

// Loads again until the box has been asked twice: the first failure must have been forgotten.
const loadAgain = async (
  store: { loadThumbnails: (session: string, rows: FluxEvent[]) => void },
  reads: () => number,
): Promise<void> => {
  store.loadThumbnails('s1', sent);
  if (reads() >= 2) return;
  await turn();
  return loadAgain(store, reads);
};

test('a thumbnail the box refuses is tried again on the next load', async () => {
  const { store, calls } = await pairedStore([], {
    'attach.read': () => {
      throw new ClientError('not_found', 'gone');
    },
  });
  store.loadThumbnails('s1', sent);
  await until(() => calls('attach.read').length === 1);
  await loadAgain(store, () => calls('attach.read').length);
  expect(calls('attach.read')).toHaveLength(2);
  expect(store.state.thumbs).toEqual({});
  store.stop();
});
