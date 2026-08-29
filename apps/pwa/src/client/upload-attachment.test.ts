import type { RpcMethods } from '@flux/protocol';
import { expect, test } from 'vitest';

import { base64 } from './base64.ts';
import { ClientError } from './client-error.ts';
import type { RpcCall } from './create-rpc-client.ts';
import { uploadAttachment } from './upload-attachment.ts';

// A recording box: every call is kept, chunks are reassembled, and `fail` names a method to
// refuse.

const box = (fail = '') => {
  const calls: { method: string; params: unknown }[] = [];
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const call: RpcCall = (method, params) => {
    calls.push({ method, params });
    if (method === fail) return Promise.reject(new ClientError('internal', `${method} failed`));
    if (method === 'attach.begin') return Promise.resolve({ attachmentId: 'att-1' });
    const p = params as RpcMethods['attach.chunk']['params'];
    if (method === 'attach.chunk') chunks[p.index] = base64.decode(p.data);
    if (method === 'attach.end') return Promise.resolve({ path: '/box/att-1', size: 0 });
    return Promise.resolve({});
  };
  return { calls, chunks, call };
};

const options = (file: File, call: RpcCall, cancelled = () => false) => {
  const begun: string[] = [];
  const progress: number[] = [];
  return {
    begun,
    progress,
    options: {
      call,
      session: 's1',
      file,
      onBegun: (id: string) => {
        begun.push(id);
      },
      onProgress: (f: number) => {
        progress.push(f);
      },
      cancelled,
    },
  };
};

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

test('begins, sends sequential chunks, ends with the sha256 of the whole file', async () => {
  const bytes = new Uint8Array(512 * 1024 + 100).map((_, i) => i % 7);
  const file = new File([bytes], 'big bin', { type: '' });
  const { calls, chunks, call } = box();
  const { begun, progress, options: o } = options(file, call);
  expect(await uploadAttachment(o)).toBe('att-1');
  expect(begun).toEqual(['att-1']);
  expect(calls.map((c) => c.method)).toEqual([
    'attach.begin',
    'attach.chunk',
    'attach.chunk',
    'attach.end',
  ]);
  expect(calls[0]?.params).toEqual({
    session: 's1',
    name: 'big bin',
    mime: 'application/octet-stream',
    size: bytes.length,
  });
  expect(chunks.map((c) => c.length)).toEqual([512 * 1024, 100]);
  expect(new Uint8Array(await new Blob(chunks).arrayBuffer())).toEqual(bytes);
  expect(calls.at(-1)?.params).toEqual({
    attachmentId: 'att-1',
    hash: hex(await crypto.subtle.digest('SHA-256', bytes)),
  });
  expect(progress.at(-1)).toBe(1);
  expect(progress[0]).toBeCloseTo(0.9998, 3);
});

test('an empty file is one begin and one end', async () => {
  const { calls, call } = box();
  const { options: o } = options(new File([], 'empty.txt', { type: 'text/plain' }), call);
  await uploadAttachment(o);
  expect(calls.map((c) => c.method)).toEqual(['attach.begin', 'attach.end']);
  expect(calls[0]?.params).toMatchObject({ mime: 'text/plain', size: 0 });
});

test('a refusal from the box rejects with its error; a removal stops before the next chunk', async () => {
  const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
  const { call } = box('attach.end');
  await expect(uploadAttachment(options(file, call).options)).rejects.toMatchObject({
    code: 'internal',
    message: 'attach.end failed',
  });
  const gone = box();
  const { calls } = gone;
  await expect(
    uploadAttachment(options(file, gone.call, () => true).options),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(calls.map((c) => c.method)).toEqual(['attach.begin']);
});
