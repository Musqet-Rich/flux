import type { DatabaseSync } from 'node:sqlite';

// Ordered, idempotent database migrations, run once at boot after the schema exists and before
// anything reads the event log (open-database.ts). The daemon self-updates (ADR 0021/0022): the
// one SQLite file (ADR 0006) survives across code swaps, so a change to a persisted shape needs a
// migration here, not a crash on the next read.
//
// Version tracking is `PRAGMA user_version` — a signed integer in the SQLite file header — rather
// than a `migrations` table: the daemon owns its one file and single-writes it, the migration set
// is a short append-only list, and there is nothing to query about applied-at times, so the header
// int is the whole state. `up` runs only when the stored version is below the migration's; the set
// advances the version to the latest only after every `up` has succeeded, so a crash mid-set leaves
// the version behind and the whole set re-runs on the next boot (each `up` must be a no-op on rows
// it has already migrated). Extend by appending a migration with the next version number.

interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

// 001: PR #50 renamed the persisted `session.created` field `agent` to `harness`. A row written
// before then has `agent` and no `harness`, so it fails `fluxEvent.is()` on read and throws
// `stored event N is invalid` (create-event-log.ts). Rewrite the JSON payload in place; the
// `$.agent IS NOT NULL` guard makes it a no-op on rows that already carry `harness`.
const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'session.created: agent -> harness',
    up: (db) => {
      db.exec(
        "UPDATE events SET payload = json_remove(json_set(payload, '$.harness', json_extract(payload, '$.agent')), '$.agent') WHERE type = 'session.created' AND json_extract(payload, '$.agent') IS NOT NULL",
      );
    },
  },
];

const latestVersion = migrations.reduce((max, m) => (m.version > max ? m.version : max), 0);

const currentVersion = (db: DatabaseSync): number => {
  const row = db.prepare('PRAGMA user_version').get();
  const value = row === undefined ? 0 : row['user_version'];
  return typeof value === 'number' ? value : 0;
};

export const runMigrations = (db: DatabaseSync): void => {
  const from = currentVersion(db);
  for (const migration of migrations) {
    if (migration.version > from) migration.up(db);
  }
  if (latestVersion > from) db.exec(`PRAGMA user_version = ${latestVersion}`);
};
