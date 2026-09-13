import { expect, test } from 'vitest';

import { fonts } from './fonts.ts';

test('ten families for each part, each shipped', () => {
  expect(fonts.parts).toEqual(['text', 'code']);
  expect(fonts.families.text).toHaveLength(10);
  expect(fonts.families.code).toHaveLength(10);
  expect(fonts.isShipped('text', 'Inter')).toBe(true);
  expect(fonts.isShipped('code', 'Inter')).toBe(false);
});

test('the fonts of a theme or of the stored choices read in the fixed order, any family name', () => {
  expect(fonts.read({ code: 'Nova Mono', text: ' Comic Sans ' })).toEqual({
    ok: true,
    fonts: { text: 'Comic Sans', code: 'Nova Mono' },
  });
  expect(Object.keys(fonts.read({ code: 'x', text: 'y' }))).toEqual(['ok', 'fonts']);
  expect(fonts.read({})).toEqual({ ok: true, fonts: {} });
  expect(fonts.read(['Inter'])).toEqual({
    ok: false,
    reason: 'fonts must be an object: {"text": ..., "code": ...}',
  });
  expect(fonts.read({ mono: 'Inter' })).toEqual({
    ok: false,
    reason: 'fonts.mono is not a part: text, code',
  });
  expect(fonts.read({ ['k'.repeat(40)]: 'Inter' })).toEqual({
    ok: false,
    reason: `fonts.${'k'.repeat(32)}… is not a part: text, code`,
  });
  expect(fonts.read({ text: 7 })).toEqual({
    ok: false,
    reason: 'fonts.text must be a family name',
  });
  expect(fonts.read({ code: ' ' })).toEqual({
    ok: false,
    reason: 'fonts.code must be a family name',
  });
  expect(fonts.read({ text: 'x'.repeat(65) })).toEqual({
    ok: false,
    reason: 'fonts.text must be a family name',
  });
});

test('the properties the choice sets are the platform stacks unless a shipped family is chosen', () => {
  expect(fonts.css({})).toEqual({
    '--font-text': "system-ui, -apple-system, 'Segoe UI', sans-serif",
    '--font-code': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });
  expect(fonts.css({ text: 'Inter', code: 'Comic Sans' })).toEqual({
    '--font-text': "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    '--font-code': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });
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
