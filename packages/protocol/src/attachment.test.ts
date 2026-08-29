import { expect, test } from 'vitest';

import { attachment } from './attachment.ts';

const full = { id: 'a', name: 'shot.png', mime: 'image/png', size: 12, image: true };

test('guards an attachment', () => {
  expect(attachment.is(full)).toBe(true);
  expect(attachment.is({ ...full, image: false })).toBe(true);
  expect(attachment.is({ ...full, size: -1 })).toBe(false);
  expect(attachment.is({ ...full, image: 'yes' })).toBe(false);
  expect(attachment.is({ ...full, id: 1 })).toBe(false);
  expect(attachment.is({ ...full, name: undefined })).toBe(false);
  expect(attachment.is({ ...full, mime: null })).toBe(false);
  expect(attachment.is(null)).toBe(false);
});

test('images are the four types the agent takes as blocks, within the block limit', () => {
  expect(attachment.isImage('image/png', 1)).toBe(true);
  expect(attachment.isImage('image/jpeg', attachment.limits.imageBytes)).toBe(true);
  expect(attachment.isImage('image/gif', 1)).toBe(true);
  expect(attachment.isImage('image/webp', 1)).toBe(true);
  expect(attachment.isImage('image/svg+xml', 1)).toBe(false);
  expect(attachment.isImage('image/png', attachment.limits.imageBytes + 1)).toBe(false);
  expect(attachment.imageTypes).toHaveLength(4);
});

test('the caps are the ones protocol.md states', () => {
  expect(attachment.limits).toEqual({
    fileBytes: 20 * 1024 * 1024,
    messageBytes: 50 * 1024 * 1024,
    chunkBytes: 512 * 1024,
    readBytes: 512 * 1024,
    imageBytes: 5 * 1024 * 1024,
  });
});
