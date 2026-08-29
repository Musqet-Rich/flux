import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { attachmentImages } from './attachment-images.ts';

const png = fileURLToPath(new URL('../test/red.png', import.meta.url));

test('images within the limit become base64 blocks; other files and unreadable ones do not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-images-'));
  const text = join(dir, 'notes.txt');
  await writeFile(text, 'hello');
  const blocks = await attachmentImages([
    { path: png, mime: 'image/png', size: 75 },
    { path: text, mime: 'text/plain', size: 5 },
    { path: join(dir, 'gone.jpg'), mime: 'image/jpeg', size: 10 },
    { path: png, mime: 'image/png', size: 6 * 1024 * 1024 },
    { path: png, mime: 'image/svg+xml', size: 75 },
  ]);
  expect(blocks).toEqual([
    { mediaType: 'image/png', data: (await readFile(png)).toString('base64') },
  ]);
});
