import type { EventPayloads, EventType, FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import type { DatabaseSync } from 'node:sqlite';

import { DaemonError } from './daemon-error.ts';

// Append-only per-session log with a gapless seq (protocol.md § 5, ADR 0006). This is the
// source of truth for everything the PWA shows; the sync model in architecture.md rests on
// seq being dense, so append is the only writer and it runs inside one transaction.

// A discriminated union over every event type, so narrowing on `type` narrows `payload`.
// `parent` is the Agent call a subagent's event belongs to (protocol.md § 5), absent otherwise.
export type EventInput = {
  [T in EventType]: { type: T; payload: EventPayloads[T]; parent?: string };
}[EventType];

export interface EventPage {
  events: FluxEvent[];
  complete: boolean;
}

export interface EventLog {
  append: (session: string, input: EventInput) => FluxEvent;
  read: (session: string, since: number, limit?: number) => EventPage;
  lastSeq: (session: string) => number;
}

export interface EventLogOptions {
  db: DatabaseSync;
  now?: () => Date;
}

const defaultPageSize = 500;

const rowToEvent = (session: string, row: Record<string, unknown>): FluxEvent => {
  const payload: unknown = JSON.parse(String(row['payload']));
  const parent = row['parent'];
  const candidate: unknown = {
    seq: row['seq'],
    ts: row['ts'],
    session,
    type: row['type'],
    payload,
    ...(typeof parent === 'string' ? { parent } : {}),
  };
  if (!fluxEvent.is(candidate)) {
    throw new DaemonError('internal', `stored event ${String(row['seq'])} is invalid`);
  }
  return candidate;
};

export const createEventLog = (options: EventLogOptions): EventLog => {
  const { db } = options;
  const now = options.now ?? ((): Date => new Date());
  const last = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE session = ?');
  const insert = db.prepare(
    'INSERT INTO events (session, seq, ts, type, payload, parent) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const page = db.prepare(
    'SELECT seq, ts, type, payload, parent FROM events WHERE session = ? AND seq > ? ORDER BY seq LIMIT ?',
  );

  const lastSeq = (session: string): number => {
    const row = last.get(session);
    return typeof row?.['seq'] === 'number' ? row['seq'] : 0;
  };

  const append = (session: string, input: EventInput): FluxEvent => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const seq = lastSeq(session) + 1;
      const ts = now().toISOString();
      const event: unknown = {
        seq,
        ts,
        session,
        type: input.type,
        payload: input.payload,
        ...(input.parent === undefined ? {} : { parent: input.parent }),
      };
      if (!fluxEvent.is(event)) {
        throw new DaemonError('internal', `payload for ${input.type} is invalid`);
      }
      insert.run(session, seq, ts, input.type, JSON.stringify(input.payload), input.parent ?? null);
      db.exec('COMMIT');
      return event;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  const read = (session: string, since: number, limit = defaultPageSize): EventPage => {
    const rows = page.all(session, since, limit + 1);
    const events = rows.slice(0, limit).map((row) => rowToEvent(session, row));
    return { events, complete: rows.length <= limit };
  };

  return { append, read, lastSeq };
};
