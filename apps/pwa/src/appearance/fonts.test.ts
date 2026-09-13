import { expect, test } from 'vitest';

import { fonts } from './fonts.ts';

test('ten families for each part, each shipped', () => {
  expect(fonts.parts).toEqual(['text', 'code']);
  expect(fonts.families.text).toHaveLength(10);
  expect(fonts.families.code).toHaveLength(10);
  expect(fonts.isShipped('text', 'Inter')).toBe(true);
  expect(fonts.isShipped('code', 'Inter')).toBe(false);
});

test('a stack is the family ahead of the platform stack, or the platform stack alone', () => {
  expect(fonts.stack('code', 'Cascadia Code')).toBe(
    "'Cascadia Code', ui-monospace, SFMono-Regular, Menlo, monospace",
  );
  expect(fonts.stack('text')).toBe(fonts.platform.text);
  // A family another device ships and this one does not.
  expect(fonts.stack('text', 'Comic Sans')).toBe(fonts.platform.text);
  // A text family named for code is not one the app ships for code.
  expect(fonts.stack('code', 'Inter')).toBe(fonts.platform.code);
});
