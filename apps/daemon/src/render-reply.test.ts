import { expect, test } from 'vitest';

import { renderReply } from './render-reply.ts';

test('a message without a reply is unchanged', () => {
  expect(renderReply('hello', null)).toBe('hello');
});

test('a reply to the agent quotes its message as a block, blank lines included', () => {
  const out = renderReply('yes, that one', {
    seq: 4,
    from: 'assistant',
    text: 'Plan:\n\n- a\n- b',
  });
  expect(out).toBe(
    'In reply to your earlier message:\n\n> Plan:\n>\n> - a\n> - b\n\nyes, that one',
  );
});

test("a reply to the operator's own message says so", () => {
  const out = renderReply('and this', { seq: 2, from: 'user', text: 'do x' });
  expect(out).toBe('In reply to my earlier message:\n\n> do x\n\nand this');
});

test('a long quote is cut at 20 lines with a marker', () => {
  const text = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
  const out = renderReply('ok', { seq: 1, from: 'assistant', text });
  expect(out).toContain('> l19\n> …\n\nok');
  expect(out).not.toContain('l20');
});
