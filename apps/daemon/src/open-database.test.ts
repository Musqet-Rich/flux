import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  ]);
  expect(second.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.['n']).toBe(1);
  second.close();
});

test('works in memory for tests', () => {
  const db = openDatabase(':memory:');
  expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()?.['n']).toBe(0);
  db.close();
});
