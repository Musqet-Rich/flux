import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

import { createEventLog } from './create-event-log.ts';
import { openDatabase } from './open-database.ts';
import { runMigrations } from './run-migrations.ts';

// A bare events table (open-database.ts schema) on a fresh db, whose `user_version` starts at 0 —
// so a migration below its version actually runs, unlike `openDatabase`, which has already
// migrated the handle it returns.
const openEvents = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE events (session TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, parent TEXT, PRIMARY KEY (session, seq)) WITHOUT ROWID',
  );
  return db;
};

const insert = (db: DatabaseSync, seq: number, payload: Record<string, unknown>): void => {
  db.prepare(
    'INSERT INTO events (session, seq, ts, type, payload, parent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('s', seq, '2026-08-29T10:00:00.000Z', 'session.created', JSON.stringify(payload), null);
};

const userVersion = (db: DatabaseSync): unknown =>
  db.prepare('PRAGMA user_version').get()?.['user_version'];

const oldRow = { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', agent: 'claude' };
const newRow = { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', harness: 'claude' };

test('migration 001 rescues a pre-harness row the event log would otherwise reject', () => {
  const db = openEvents();
  insert(db, 1, oldRow);
  const log = createEventLog({ db });
  // The un-migrated `agent`-shaped payload fails the strict guard on read.
  expect(() => log.read('s', 0)).toThrow(/stored event 1 is invalid/u);
  runMigrations(db);
  // Now it reads as a valid `session.created` with `harness` and no `agent`.
  expect(log.read('s', 0).events[0]?.payload).toEqual(newRow);
  expect(userVersion(db)).toBe(1);
});

test('running migrations twice is a no-op and leaves the version at the latest', () => {
  const db = openEvents();
  insert(db, 1, oldRow);
  runMigrations(db);
  const afterFirst = db.prepare('SELECT payload FROM events WHERE seq = 1').get()?.['payload'];
  runMigrations(db);
  const afterSecond = db.prepare('SELECT payload FROM events WHERE seq = 1').get()?.['payload'];
  expect(afterSecond).toBe(afterFirst);
  expect(JSON.parse(String(afterSecond))).toEqual(newRow);
  expect(userVersion(db)).toBe(1);
});

test('a row already at the new shape is left untouched', () => {
  const db = openEvents();
  insert(db, 1, newRow);
  runMigrations(db);
  expect(createEventLog({ db }).read('s', 0).events[0]?.payload).toEqual(newRow);
  expect(userVersion(db)).toBe(1);
});

test('a fresh db migrates to the latest and round-trips a new session.created event', () => {
  const db = openDatabase(':memory:');
  // openDatabase already ran the migrations on this handle.
  expect(userVersion(db)).toBe(1);
  const log = createEventLog({ db });
  log.append('s', {
    type: 'session.created',
    payload: { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', harness: 'pi' },
  });
  expect(log.read('s', 0).events[0]?.payload).toEqual({
    repo: '/r',
    worktree: '/w',
    branch: 'b',
    base: 'abc',
    harness: 'pi',
  });
});
