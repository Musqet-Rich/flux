import { DatabaseSync } from 'node:sqlite';

export interface EventRow {
  seq: number;
  type: string;
}

// The events the daemon's log holds for a session, seq and type only, read straight from its
// SQLite file (ADR 0006): the box is the source of truth the PWA's timeline is checked against.
export const eventRows = (database: string, session: string): EventRow[] => {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rows = db
      .prepare('SELECT seq, type FROM events WHERE session = ? ORDER BY seq')
      .all(session);
    return rows.map((row) => ({ seq: Number(row['seq']), type: String(row['type']) }));
  } finally {
    db.close();
  }
};
