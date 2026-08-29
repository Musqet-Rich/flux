import { DatabaseSync } from 'node:sqlite';

// One SQLite file for everything the daemon persists (ADR 0006). The schema is applied on every
// open with IF NOT EXISTS; there are no migrations yet, and there will be none until a release.

const schema = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS events (
    session TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
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
    paired_at TEXT NOT NULL
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
`;

export const openDatabase = (path: string): DatabaseSync => {
  const db = new DatabaseSync(path);
  db.exec(schema);
  return db;
};
