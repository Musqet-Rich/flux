import { expect, test } from 'vitest';

import { toolSummary } from './tool-summary.ts';

const cwd = '/work/repo';

test.each([
  ['Bash', { command: 'pnpm test' }, 'Bash: pnpm test'],
  ['Bash', { command: 'echo   a\n  b' }, 'Bash: echo a b'],
  ['Write', { file_path: '/work/repo/src/a.ts' }, 'Write src/a.ts'],
  ['Edit', { file_path: '/elsewhere/b.ts' }, 'Edit /elsewhere/b.ts'],
  ['Read', {}, 'Read ?'],
  ['Glob', { pattern: '**/*.vue' }, 'Glob **/*.vue'],
  ['Grep', { pattern: 'needle' }, 'Grep needle'],
  ['WebFetch', { url: 'https://x.y' }, 'WebFetch https://x.y'],
  ['WebSearch', { query: 'hono ws' }, 'WebSearch hono ws'],
  ['Task', { description: 'explore' }, 'Task: explore'],
  ['flux_ask', { question: 'deploy?' }, 'flux_ask'],
  ['Bash', 'not an object', 'Bash:'],
])('start summary for %s', (name, input, expected) => {
  expect(toolSummary.start(name, input, cwd)).toBe(expected);
});

test('start summaries are clipped to one short line', () => {
  const long = toolSummary.start('Bash', { command: 'x'.repeat(500) }, cwd);
  expect(long.length).toBe(120);
  expect(long.endsWith('…')).toBe(true);
});

test.each([
  ['Bash', true, { stdout: 'a\nb\nc' }, 'Bash ok, 3 lines'],
  ['Bash', true, { stdout: 'one' }, 'Bash ok, 1 line'],
  ['Bash', false, { stdout: '' }, 'Bash failed, 0 lines'],
  ['Bash', true, undefined, 'Bash ok, 0 lines'],
  ['Read', true, { file: { numLines: 42 } }, 'Read ok, 42 lines'],
  ['Read', true, {}, 'Read ok'],
  ['Write', true, { type: 'create' }, 'Write ok'],
  ['Edit', false, null, 'Edit failed'],
])('end summary for %s', (name, ok, result, expected) => {
  expect(toolSummary.end(name, ok, result)).toBe(expected);
});

// A subagent's tool_result has no tool_use_result, so its content is what there is to count;
// the structured result wins when both are present, and non-text content counts nothing.
test.each([
  ['Bash', true, undefined, 'total 16\na.txt\nb.txt', 'Bash ok, 3 lines'],
  ['Bash', true, { stdout: 'one' }, 'x\ny', 'Bash ok, 1 line'],
  ['Bash', true, undefined, [{ type: 'text', text: 'a' }], 'Bash ok, 0 lines'],
  ['Read', true, undefined, 'a\nb', 'Read ok'],
])('end summary for %s from the block content', (name, ok, result, content, expected) => {
  expect(toolSummary.end(name, ok, result, content)).toBe(expected);
});

test('writes marks the tools that can change the worktree', () => {
  expect(['Write', 'Edit', 'NotebookEdit', 'Bash'].map((n) => toolSummary.writes(n))).toEqual([
    true,
    true,
    true,
    true,
  ]);
  expect(['Read', 'Grep', 'WebFetch', 'flux_ask'].map((n) => toolSummary.writes(n))).toEqual([
    false,
    false,
    false,
    false,
  ]);
});
