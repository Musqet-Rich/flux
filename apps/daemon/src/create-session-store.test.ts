import { expect, test } from 'vitest';

import { createSessionStore } from './create-session-store.ts';
import { DaemonError } from './daemon-error.ts';
import { openDatabase } from './open-database.ts';

const setup = () => {
  const seqs = new Map<string, number>();
  const clock = { t: 0 };
  const now = (): Date => new Date(Date.UTC(2026, 7, 29, 10) + clock.t);
  const gone = new Set<string>();
  const store = createSessionStore({
    db: openDatabase(':memory:'),
    lastSeq: (session) => seqs.get(session) ?? 0,
    now,
    worktreeExists: (path) => !gone.has(path),
  });
  return { store, seqs, clock, gone };
};

const input = {
  session: 's1',
  title: 'Fix login',
  repo: '/repos/app',
  worktree: '/repos/app/.flux/s1',
  branch: 'flux/fix-login',
  base: 'abc123',
  harness: 'claude' as const,
};

test('create returns the full record with defaults', () => {
  const { store } = setup();
  expect(store.create(input)).toEqual({
    ...input,
    agentSessionId: null,
    state: 'idle',
    archived: false,
    lastSeq: 0,
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
  });
});

test('list gives summaries, newest first, archived ones flagged with their worktree', () => {
  const { store, seqs, clock, gone } = setup();
  store.create(input);
  clock.t = 1000;
  store.create({ ...input, session: 's2', title: 'Second' });
  store.create({ ...input, session: 's3', title: 'Archived', worktree: '/gone' });
  clock.t = 2000;
  store.setArchived('s3', true);
  gone.add('/gone');
  seqs.set('s1', 7);
  const list = store.list();
  expect(list.map((s) => s.session)).toEqual(['s3', 's2', 's1']);
  expect(list[0]).toMatchObject({ archived: true, worktreeExists: false });
  expect(list[2]).toEqual({
    session: 's1',
    title: 'Fix login',
    repo: '/repos/app',
    branch: 'flux/fix-login',
    harness: 'claude',
    state: 'idle',
    lastSeq: 7,
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    archived: false,
    worktreeExists: true,
  });
});

test('setters update the row and bump updatedAt', () => {
  const { store, clock } = setup();
  store.create(input);
  clock.t = 5000;
  store.setState('s1', 'running');
  store.setAgentSessionId('s1', 'agent-uuid');
  store.setTitle('s1', 'Renamed');
  const record = store.get('s1');
  expect(record.state).toBe('running');
  expect(record.agentSessionId).toBe('agent-uuid');
  expect(record.title).toBe('Renamed');
  expect(record.updatedAt).toBe('2026-08-29T10:00:05.000Z');
  store.setState('s1', 'waiting_user');
  expect(store.get('s1').state).toBe('waiting_user');
  store.setState('s1', 'ended');
  expect(store.get('s1').state).toBe('ended');
  store.setAgentSessionId('s1', null);
  expect(store.get('s1').agentSessionId).toBeNull();
});

test('unknown sessions raise not_found', () => {
  const { store } = setup();
  expect(() => store.get('nope')).toThrow(DaemonError);
  expect(() => {
    store.setState('nope', 'idle');
  }).toThrow(DaemonError);
});

test('tolerates unknown harness and state values from older rows', () => {
  const { store } = setup();
  store.create({ ...input, harness: 'pi' });
  expect(store.get('s1').harness).toBe('pi');
  const db = openDatabase(':memory:');
  const other = createSessionStore({ db, lastSeq: () => 0 });
  db.exec(
    "INSERT INTO sessions (session, title, repo, worktree, branch, base, agent, state, created_at, updated_at) VALUES ('x', 't', '/r', '/w', 'b', 'base', 'future-agent', 'future-state', 'now', 'now')",
  );
  expect(other.get('x').harness).toBe('claude');
  expect(other.get('x').state).toBe('idle');
});

test('persists model and effort and omits them when unset', () => {
  const { store } = setup();
  store.create({ ...input, session: 'm1', model: 'opus', effort: 'high' });
  expect(store.get('m1')).toMatchObject({ model: 'opus', effort: 'high' });
  store.create({ ...input, session: 'm2' });
  const bare = store.get('m2');
  expect('model' in bare).toBe(false);
  expect('effort' in bare).toBe(false);
});
