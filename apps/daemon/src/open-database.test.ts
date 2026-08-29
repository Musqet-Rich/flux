import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

import { openDatabase } from './open-database.ts';

test('creates the schema and is idempotent on reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-db-'));
  const path = join(dir, 'flux.sqlite');
  const first = openDatabase(path);
  first.exec(
    "INSERT INTO sessions VALUES ('s', 't', '/r', '/w', 'b', 'base', 'claude', NULL, 'idle', 0, 'now', 'now')",
  );
  first.close();
  const second = openDatabase(path);
  const tables = second
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row['name']);
  expect(tables).toEqual([
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
