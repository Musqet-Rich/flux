import type { AgentSpec } from '@flux/protocol';
import { expect, test } from 'vitest';

import { DaemonError } from './daemon-error.ts';
import { resolveAgent } from './resolve-agent.ts';

const agents: AgentSpec[] = [
  {
    name: 'reviewer',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    role: 'be terse',
    tools: { mode: 'deny', list: ['Bash'] },
  },
  { name: 'bare' },
];

test('a named agent supplies model, effort, role and tools', () => {
  expect(resolveAgent({ agent: 'reviewer' }, agents)).toEqual({
    model: 'opus',
    effort: 'high',
    role: 'be terse',
    tools: { mode: 'deny', list: ['Bash'] },
  });
});

test('tools come from the agent only, and are omitted when it has none', () => {
  expect('tools' in resolveAgent({ agent: 'bare' }, agents)).toBe(false);
  expect('tools' in resolveAgent({ model: 'fable' }, agents)).toBe(false);
});

test('inline model and effort override the agent; role and tools still come from the agent', () => {
  expect(resolveAgent({ agent: 'reviewer', model: 'sonnet', effort: 'low' }, agents)).toEqual({
    model: 'sonnet',
    effort: 'low',
    role: 'be terse',
    tools: { mode: 'deny', list: ['Bash'] },
  });
});

test('inline values apply with no agent, and unset fields are omitted', () => {
  expect(resolveAgent({ model: 'fable' }, agents)).toEqual({ model: 'fable' });
  const bare = resolveAgent({}, agents);
  expect('model' in bare).toBe(false);
  expect('effort' in bare).toBe(false);
  expect('role' in bare).toBe(false);
});

test('an agent with no fields set resolves to nothing', () => {
  expect(resolveAgent({ agent: 'bare' }, agents)).toEqual({});
});

// The wire code (`bad_params`) is asserted end-to-end in create-daemon.test.ts; here the type.
test('an unknown agent name throws a DaemonError', () => {
  expect(() => resolveAgent({ agent: 'ghost' }, agents)).toThrow(DaemonError);
  expect(() => resolveAgent({ agent: 'ghost' }, agents)).toThrow('no saved agent named ghost');
});
