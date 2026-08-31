import { expect, test } from 'vitest';

import { opencodeToolSummary } from './opencode-tool-summary.ts';

const cwd = '/w';

test('start summaries name the tool and its salient argument', () => {
  expect(opencodeToolSummary.start('bash', { command: 'ls -la' }, cwd)).toBe('bash: ls -la');
  expect(opencodeToolSummary.start('read', { filePath: '/w/src/a.ts' }, cwd)).toBe('read src/a.ts');
  expect(opencodeToolSummary.start('write', { path: '/other/b.ts' }, cwd)).toBe(
    'write /other/b.ts',
  );
  expect(opencodeToolSummary.start('grep', { pattern: 'router' }, cwd)).toBe('grep router');
  expect(opencodeToolSummary.start('glob', { pattern: '**/*.ts' }, cwd)).toBe('glob **/*.ts');
  expect(opencodeToolSummary.start('list', { path: '/w/src' }, cwd)).toBe('list src');
  expect(opencodeToolSummary.start('flux_ask', { question: 'ship it?' }, cwd)).toBe(
    'ask: ship it?',
  );
  expect(opencodeToolSummary.start('flux_notify', { level: 'done', summary: 'built' }, cwd)).toBe(
    'notify done: built',
  );
  expect(opencodeToolSummary.start('webfetch', {}, cwd)).toBe('webfetch');
});

test('a missing path argument is shown as a question mark', () => {
  expect(opencodeToolSummary.start('read', {}, cwd)).toBe('read ?');
});

test('end summaries carry the status and, for bash/read, the line count', () => {
  expect(opencodeToolSummary.end('bash', true, 'one\ntwo\n')).toBe('bash ok, 2 lines');
  expect(opencodeToolSummary.end('read', true, 'only')).toBe('read ok, 1 line');
  expect(opencodeToolSummary.end('bash', true, '')).toBe('bash ok, 0 lines');
  expect(opencodeToolSummary.end('write', false, '')).toBe('write failed');
});

test('only the writing tools mark the worktree changed', () => {
  for (const name of ['write', 'edit', 'bash', 'patch']) {
    expect(opencodeToolSummary.writes(name)).toBe(true);
  }
  for (const name of ['read', 'grep', 'glob', 'list', 'webfetch']) {
    expect(opencodeToolSummary.writes(name)).toBe(false);
  }
});
