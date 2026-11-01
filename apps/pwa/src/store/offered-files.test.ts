import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { base64 } from '../client/base64.ts';
import { ClientError } from '../client/client-error.ts';

// Files the agent offered (`file.offered`, ADR 0036) against a fake box: an offered image gets
// its thumbnail like a sent one, and any offered file is fetched whole through `attach.read`,
// page by page, as a Blob of its type, with the fraction fetched reported as it goes.

const page = 512 * 1024;
const bytes = new Uint8Array(page + 3).map((_, at) => at % 251);
const report = { id: 'f-1', name: 'report.pdf', mime: 'application/pdf', size: bytes.length };
const shot = { id: 'img-9', name: 'chart.png', mime: 'image/png', size: 3, image: true };

const row = (seq: number, payload: unknown): FluxEvent => ({
  seq,
  ts: 't',
  session: 's1',
  type: 'file.offered',
  payload,
});

const box = () =>
  pairedStore([], {
    'attach.read': (p) => ({
      data: base64.encode(bytes.subarray(p.offset, p.offset + p.length)),
      size: bytes.length,
      mime: 'application/pdf',
      name: 'report.pdf',
    }),
  });

test('an offered file comes back whole as a Blob of its type, with progress per page', async () => {
  const { store, calls } = await box();
  const seen: number[] = [];
  const blob = await store.fetchAttachment({ ...report, image: false }, (fraction) => {
    seen.push(fraction);
  });
  expect(blob.type).toBe('application/pdf');
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  expect(seen).toEqual([page / bytes.length, 1]);
  expect(calls('attach.read')).toEqual([
    { attachmentId: 'f-1', offset: 0, length: page },
    { attachmentId: 'f-1', offset: page, length: page },
  ]);
  // Without a progress callback, and for an empty file, which needs no read at all.
  const empty = await store.fetchAttachment({ ...report, id: 'f-2', size: 0, image: false });
  expect(empty.size).toBe(0);
  expect(calls('attach.read')).toHaveLength(2);
  store.stop();
});

test('a refused read rejects, for the card to show; nothing lands in the status bar', async () => {
  const { store } = await pairedStore([], {
    'attach.read': () => {
      throw new ClientError('not_found', 'attachment f-1 is gone from disk');
    },
  });
  await expect(store.fetchAttachment({ ...report, image: false })).rejects.toThrow('gone');
  expect(store.state.error).toBeNull();
  store.stop();
});

test('an offered image gets a thumbnail like a sent one; other offered files do not', async () => {
  const { store, calls } = await box();
  store.loadThumbnails('s1', [
    row(1, { attachment: shot, note: 'The chart' }),
    row(2, { attachment: { ...report, image: false } }),
  ]);
  await until(() => store.state.thumbs['img-9'] !== undefined);
  expect(store.state.thumbs['img-9']).toMatch(/^blob:/u);
  expect(calls('attach.read')).toEqual([{ attachmentId: 'img-9', offset: 0, length: page }]);
  store.stop();
});
