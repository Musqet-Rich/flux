import { DatabaseSync } from 'node:sqlite';

// The seq numbers the daemon's event log holds for a session, read straight from its SQLite
// file (ADR 0006): the box is the source of truth the PWA's timeline is checked against.
export const eventSeqs = (database: string, session: string): number[] => {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rows = db.prepare('SELECT seq FROM events WHERE session = ? ORDER BY seq').all(session);
    return rows.map((row) => Number(row['seq']));
  } finally {
    db.close();
  }
};
