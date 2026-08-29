import type { SessionSummary } from '@flux/protocol';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { ClientError } from '../client/client-error.ts';

// The lifecycle actions refresh the list, since `archived` and `worktreeExists` are the box's;
// a `dirty` refusal comes back as an outcome for the confirm, any other failure as an error.

const listed: SessionSummary = {
  session: 's1',
  title: 'First',
  repo: '/repos/r',
  branch: 'flux/one',
  agent: 'claude',
  state: 'idle',
  lastSeq: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archived: true,
  worktreeExists: true,
};

test('archive and reopen refresh the session list; clear does not', async () => {
  const { store, calls } = await pairedStore([], {
    'sessions.clear': () => ({}),
    'sessions.archive': () => ({}),
    'sessions.unarchive': () => ({}),
    'sessions.list': () => [listed],
  });
  expect(await store.clearSession('s1')).toBe(true);
  expect(calls('sessions.list')).toEqual([]);
  expect(await store.archiveSession('s1')).toBe(true);
  await until(() => store.state.sessions[0]?.archived === true);
  expect(await store.unarchiveSession('s1')).toBe(true);
  expect(calls('sessions.list')).toHaveLength(2);
  store.stop();
});

const options = { removeWorktree: true, deleteBranch: false, discard: false };

// A box that refuses every delete with `code`.
const refusing = (code: string) =>
  pairedStore([], {
    'sessions.archive': () => {
      throw new ClientError(code, 'why');
    },
    'sessions.list': () => [],
  });

test('a dirty refusal is the outcome, not an error', async () => {
  const { store, calls } = await refusing('dirty');
  expect(await store.deleteSession('s1', options)).toEqual({ ok: false, dirty: 'why' });
  expect(store.state.error).toBeNull();
  expect(calls('sessions.list')).toEqual([]);
  store.stop();
});

test('any other refusal lands in state.error', async () => {
  const { store, calls } = await refusing('git_error');
  expect(await store.deleteSession('s1', options)).toEqual({ ok: false, dirty: null });
  expect(store.state.error).toEqual({ message: 'why', kind: 'action' });
  expect(calls('sessions.list')).toEqual([]);
  store.stop();
});

test('a delete that went through refreshes the list and clears a standing action error', async () => {
  const { store, calls } = await pairedStore([], {
    'sessions.clear': () => {
      throw new ClientError('internal', 'earlier');
    },
    'sessions.archive': () => ({}),
    'sessions.list': () => [],
  });
  expect(await store.clearSession('s1')).toBe(false);
  expect(store.state.error).toEqual({ message: 'earlier', kind: 'action' });
  expect(await store.deleteSession('s1', { ...options, discard: true })).toEqual({ ok: true });
  expect(store.state.error).toBeNull();
  expect(calls('sessions.archive')).toEqual([{ session: 's1', ...options, discard: true }]);
  await until(() => store.state.sessions.length === 0);
  store.stop();
});

test('rename sends the title and leaves the list to the session.renamed event', async () => {
  const { store, calls } = await pairedStore([], {
    'sessions.rename': () => ({}),
    'sessions.list': () => [listed],
  });
  expect(await store.renameSession('s1', 'Second')).toBe(true);
  expect(calls('sessions.rename')).toEqual([{ session: 's1', title: 'Second' }]);
  expect(calls('sessions.list')).toEqual([]);
  store.stop();
});
