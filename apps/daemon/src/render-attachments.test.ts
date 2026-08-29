import { expect, test } from 'vitest';

import { renderAttachments } from './render-attachments.ts';

test('a message without attachments is unchanged', () => {
  expect(renderAttachments('hi', [])).toBe('hi');
});

test('each file is listed with its absolute path, type and a readable size', () => {
  const out = renderAttachments('look', [
    { path: '/d/attachments/s/1-shot.png', mime: 'image/png', size: 75 },
    { path: '/d/attachments/s/2-log.txt', mime: 'text/plain', size: 15 * 1024 },
    { path: '/d/attachments/s/3-big.bin', mime: 'application/octet-stream', size: 3.5 * 1048576 },
    { path: '/d/attachments/s/4-huge.bin', mime: 'application/octet-stream', size: 200 * 1048576 },
  ]);
  expect(out).toBe(
    [
      'look',
      '',
      'Attached: /d/attachments/s/1-shot.png (image/png, 75 B)',
      'Attached: /d/attachments/s/2-log.txt (text/plain, 15.0 KiB)',
      'Attached: /d/attachments/s/3-big.bin (application/octet-stream, 3.5 MiB)',
      'Attached: /d/attachments/s/4-huge.bin (application/octet-stream, 200 MiB)',
    ].join('\n'),
  );
});
