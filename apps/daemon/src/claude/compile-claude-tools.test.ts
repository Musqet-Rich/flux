import { expect, test } from 'vitest';

import { compileClaudeTools } from './compile-claude-tools.ts';

test('all (and unset) emit no tools flag — the full toolset, today’s behaviour', () => {
  expect(compileClaudeTools()).toEqual([]);
  expect(compileClaudeTools({ mode: 'all' })).toEqual([]);
});

test('allow restricts the built-in set with --tools', () => {
  expect(compileClaudeTools({ mode: 'allow', list: ['Bash', 'Edit'] })).toEqual([
    '--tools',
    'Bash,Edit',
  ]);
});

test('deny removes the named built-ins with --disallowedTools', () => {
  expect(compileClaudeTools({ mode: 'deny', list: ['Bash', 'Edit', 'Write'] })).toEqual([
    '--disallowedTools',
    'Bash,Edit,Write',
  ]);
});

test('none disables every built-in tool with --tools ""', () => {
  expect(compileClaudeTools({ mode: 'none' })).toEqual(['--tools', '']);
});

// The floor: the Flux tools ride on --mcp-config, so they must never be named in a denylist —
// naming them there is the one way to actually strip them. A deny list that includes them, by
// bare name or full MCP id or the server prefix, has them filtered out.
test('deny never disallows the Flux tools (the floor)', () => {
  const args = compileClaudeTools({
    mode: 'deny',
    list: [
      'Bash',
      'flux_ask',
      'flux_notify',
      'flux_compact',
      'flux_help',
      'mcp__flux__flux_ask',
      'mcp__flux',
    ],
  });
  expect(args).toEqual(['--disallowedTools', 'Bash']);
  expect(args.join(' ')).not.toMatch(/flux/u);
});

// none must leave the Flux tools usable: it emits --tools "" (built-ins gone, MCP tools survive),
// and never a --disallowedTools that could name them.
test('none keeps the Flux tools by not disallowing anything', () => {
  const args = compileClaudeTools({ mode: 'none' });
  expect(args).not.toContain('--disallowedTools');
  expect(args.join(' ')).not.toMatch(/flux/u);
});

// allow leaves the Flux tools out of --tools (they are MCP, not built-in, and survive regardless);
// naming them would be wrong, so they are stripped.
test('allow does not name the Flux tools in --tools', () => {
  expect(compileClaudeTools({ mode: 'allow', list: ['Read', 'flux_ask'] })).toEqual([
    '--tools',
    'Read',
  ]);
});
