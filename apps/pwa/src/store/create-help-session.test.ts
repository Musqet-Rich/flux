import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';

// The store's createHelpSession action (ADR 0008): it trims the question, calls
// `sessions.createHelp`, and adds the returned session to the list.

test('createHelpSession sends the trimmed question and adds the returned session', async () => {
  const box = await pairedStore([], {
    'sessions.createHelp': (p) => ({
      session: 'help-1',
      title: p.question,
      repo: '/data/help',
      branch: 'help-abc123',
      harness: 'claude',
      state: 'idle',
      lastSeq: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }),
  });
  const created = await box.store.createHelpSession('  how do I pair a device?  ');
  expect(created.session).toBe('help-1');
  expect(box.calls('sessions.createHelp')).toEqual([{ question: 'how do I pair a device?' }]);
  expect(box.store.state.sessions.map((s) => s.session)).toContain('help-1');
  box.store.stop();
});
