import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

import { createEventLog } from './create-event-log.ts';
import { openDatabase } from './open-database.ts';

test('creates the schema and is idempotent on reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-db-'));
  const path = join(dir, 'flux.sqlite');
  const first = openDatabase(path);
  first.exec(
    "INSERT INTO sessions (session, title, repo, worktree, branch, base, agent, state, created_at, updated_at) VALUES ('s', 't', '/r', '/w', 'b', 'base', 'claude', 'idle', 'now', 'now')",
  );
  first.close();
  const second = openDatabase(path);
  const tables = second
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row['name']);
  expect(tables).toEqual([
    'attachments',
    'box_keys',
    'comments',
    'devices',
    'events',
    'push_subscriptions',
    'sessions',
    'settings',
  ]);
  expect(second.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.['n']).toBe(1);
  second.close();
});

test('adds the last_seen_at column to a devices table created before it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-db-'));
  const path = join(dir, 'flux.sqlite');
  const old = new DatabaseSync(path);
  old.exec(
    'CREATE TABLE devices (device_id TEXT PRIMARY KEY, public_key BLOB NOT NULL UNIQUE, name TEXT NOT NULL, paired_at TEXT NOT NULL)',
  );
  old.exec("INSERT INTO devices VALUES ('d', X'00', 'phone', 'then')");
  old.close();
  const db = openDatabase(path);
  expect(db.prepare('SELECT last_seen_at FROM devices').get()?.['last_seen_at']).toBeNull();
  db.close();
  openDatabase(path).close();
});

test('works in memory for tests', () => {
  const db = openDatabase(':memory:');
  expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()?.['n']).toBe(0);
  db.close();
});

// A box built before ADR 0023 has a sessions table without `model`/`effort`; both are added on
// open so a session created after the upgrade can persist them.
test('adds the sessions.model and sessions.effort columns to a table created before them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-db-'));
  const path = join(dir, 'flux.sqlite');
  const old = new DatabaseSync(path);
  old.exec(
    'CREATE TABLE sessions (session TEXT PRIMARY KEY, title TEXT NOT NULL, repo TEXT NOT NULL, worktree TEXT NOT NULL, branch TEXT NOT NULL, base TEXT NOT NULL, agent TEXT NOT NULL, agent_session_id TEXT, state TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  );
  old.exec(
    "INSERT INTO sessions (session, title, repo, worktree, branch, base, agent, state, created_at, updated_at) VALUES ('s', 't', '/r', '/w', 'b', 'base', 'claude', 'idle', 'now', 'now')",
  );
  old.close();
  const db = openDatabase(path);
  const row = db.prepare('SELECT model, effort FROM sessions').get();
  expect(row?.['model']).toBeNull();
  expect(row?.['effort']).toBeNull();
  db.close();
});

// A box built before subagent chats has an events table without `parent`; it is added on open.
test('adds the events.parent column to an events table created before it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-db-'));
  const path = join(dir, 'flux.sqlite');
  const old = new DatabaseSync(path);
  old.exec(
    'CREATE TABLE events (session TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (session, seq)) WITHOUT ROWID',
  );
  old.exec("INSERT INTO events VALUES ('s', 1, 't', 'raw', '{}')");
  old.close();
  const db = openDatabase(path);
  expect(db.prepare('SELECT parent FROM events').get()?.['parent']).toBeNull();
  db.close();
});

// A box paired before PR #50 has `session.created` rows shaped with `agent`; opening the database
// runs the migrations (run-migrations.ts) so the event log can read them without throwing.
test('migrates a pre-harness session.created row on open so the event log reads it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-db-'));
  const path = join(dir, 'flux.sqlite');
  const old = new DatabaseSync(path);
  old.exec(
    'CREATE TABLE events (session TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (session, seq)) WITHOUT ROWID',
  );
  old.exec(
    `INSERT INTO events VALUES ('s', 1, 't', 'session.created', '{"repo":"/r","worktree":"/w","branch":"b","base":"abc","agent":"claude"}')`,
  );
  old.close();
  const db = openDatabase(path);
  expect(db.prepare('PRAGMA user_version').get()?.['user_version']).toBe(1);
  expect(createEventLog({ db }).read('s', 0).events[0]?.payload).toEqual({
    repo: '/r',
    worktree: '/w',
    branch: 'b',
    base: 'abc',
    harness: 'claude',
  });
  db.close();
});
