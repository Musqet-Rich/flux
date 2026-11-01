import { expect, test } from 'vitest';

import { mimeFromName } from './mime-from-name.ts';

test('types a file by its extension, in any case', () => {
  expect(mimeFromName('shot.png')).toBe('image/png');
  expect(mimeFromName('PHOTO.JPG')).toBe('image/jpeg');
  expect(mimeFromName('report.pdf')).toBe('application/pdf');
  expect(mimeFromName('data.csv')).toBe('text/csv');
  expect(mimeFromName('archive.tar.gz')).toBe('application/gzip');
});

test('anything unknown, or with no extension, is an opaque download', () => {
  expect(mimeFromName('binary.xyz')).toBe('application/octet-stream');
  expect(mimeFromName('Makefile')).toBe('application/octet-stream');
  expect(mimeFromName('env')).toBe('application/octet-stream');
});
