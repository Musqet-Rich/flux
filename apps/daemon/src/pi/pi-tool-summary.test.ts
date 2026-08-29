import { expect, test } from 'vitest';

import { piToolSummary } from './pi-tool-summary.ts';

const cwd = '/work';

const result = (text: string): unknown => ({ content: [{ type: 'text', text }] });

test('start summaries name the tool and its main argument, relative to the worktree', () => {
  expect(piToolSummary.start('bash', { command: 'ls  -la\n' }, cwd)).toBe('bash: ls -la');
  expect(piToolSummary.start('read', { path: '/work/src/a.ts' }, cwd)).toBe('read src/a.ts');
  expect(piToolSummary.start('write', { path: 'b.ts', content: 'x' }, cwd)).toBe('write b.ts');
  expect(piToolSummary.start('edit', { path: '/elsewhere/c.ts' }, cwd)).toBe(
    'edit /elsewhere/c.ts',
  );
  expect(piToolSummary.start('grep', { pattern: 'foo' }, cwd)).toBe('grep foo');
  expect(piToolSummary.start('find', { pattern: '*.ts' }, cwd)).toBe('find *.ts');
  expect(piToolSummary.start('ls', { path: '/work/src' }, cwd)).toBe('ls src');
  expect(piToolSummary.start('ls', {}, cwd)).toBe('ls ?');
  expect(piToolSummary.start('flux_ask', { question: 'Red or blue?' }, cwd)).toBe(
    'ask: Red or blue?',
  );
  expect(piToolSummary.start('flux_notify', { level: 'done', summary: 'All green' }, cwd)).toBe(
    'notify done: All green',
  );
  expect(piToolSummary.start('custom_tool', 'not an object', cwd)).toBe('custom_tool');
  expect(piToolSummary.start('bash', { command: 'x'.repeat(200) }, cwd)).toHaveLength(120);
});

test('end summaries count lines for bash and read and say ok or failed', () => {
  expect(piToolSummary.end('bash', true, result('a\nb\n'))).toBe('bash ok, 2 lines');
  expect(piToolSummary.end('bash', true, result(''))).toBe('bash ok, 0 lines');
  expect(piToolSummary.end('read', true, result('one line'))).toBe('read ok, 1 line');
  expect(piToolSummary.end('read', false, null)).toBe('read failed, 0 lines');
  expect(piToolSummary.end('write', true, result('ok'))).toBe('write ok');
  expect(piToolSummary.end('flux_ask', false, result('x'))).toBe('flux_ask failed');
});

test('output joins the text blocks of a result and tolerates other shapes', () => {
  expect(
    piToolSummary.output({
      content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }],
    }),
  ).toBe('ab');
  expect(piToolSummary.output({ content: 'x' })).toBe('');
  expect(piToolSummary.output(null)).toBe('');
});

test('write, edit and bash may change the worktree', () => {
  expect(['write', 'edit', 'bash'].map((n) => piToolSummary.writes(n))).toEqual([true, true, true]);
  expect(['read', 'grep', 'find', 'ls', 'flux_ask'].map((n) => piToolSummary.writes(n))).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
});
