import { DatabaseSync } from 'node:sqlite';

// One SQLite file for everything the daemon persists (ADR 0006). The schema is applied on every
// open with IF NOT EXISTS; there are no migrations yet, and there will be none until a release.
// The one exception is a column added after the first build, applied below if it is missing.

const schema = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS events (
    session TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    parent TEXT,
    PRIMARY KEY (session, seq)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sessions (
    session TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    repo TEXT NOT NULL,
    worktree TEXT NOT NULL,
    branch TEXT NOT NULL,
    base TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT,
    effort TEXT,
    agent_session_id TEXT,
    state TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS box_keys (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key BLOB NOT NULL,
    private_key BLOB NOT NULL,
    vapid_public BLOB,
    vapid_private BLOB
  );
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    public_key BLOB NOT NULL UNIQUE,
    name TEXT NOT NULL,
    paired_at TEXT NOT NULL,
    last_seen_at TEXT
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    subscription TEXT NOT NULL,
    device_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comments (
    comment_id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    ref TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_seq INTEGER
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    complete INTEGER NOT NULL DEFAULT 0,
    sent_seq INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS attachments_session ON attachments (session);
  CREATE INDEX IF NOT EXISTS attachments_stale ON attachments (complete, created_at);
`;

// Columns a pre-release database lacks, added in place so a box paired before them keeps working.
const addedColumns = [
  { table: 'devices', column: 'last_seen_at', type: 'TEXT' },
  { table: 'events', column: 'parent', type: 'TEXT' },
  { table: 'sessions', column: 'model', type: 'TEXT' },
  { table: 'sessions', column: 'effort', type: 'TEXT' },
];

const addMissingColumns = (db: DatabaseSync): void => {
  for (const { table, column, type } of addedColumns) {
    const present = db
      .prepare(`SELECT name FROM pragma_table_info(?) WHERE name = ?`)
      .get(table, column);
    if (present === undefined) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
};

export const openDatabase = (path: string): DatabaseSync => {
  const db = new DatabaseSync(path);
  db.exec(schema);
  addMissingColumns(db);
  return db;
};
