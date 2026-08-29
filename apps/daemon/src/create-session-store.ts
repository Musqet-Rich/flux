import type { AgentKind, SessionState, SessionSummary } from '@flux/protocol';
import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { DaemonError } from './daemon-error.ts';

// Session rows (architecture.md § Daemon, Sessions). Small and boring on purpose: the event log
// is the history, this is only what the daemon needs to reattach and what the list screen shows.

export interface SessionRecord extends SessionSummary {
  // Optional on the wire for older daemons; this one has always stored it, so it always sends it.
  createdAt: string;
  worktree: string;
  base: string;
  agentSessionId: string | null;
  archived: boolean;
}

export interface NewSession {
  session: string;
  title: string;
  repo: string;
  worktree: string;
  branch: string;
  base: string;
  agent: AgentKind;
}

export interface SessionStore {
  create: (input: NewSession) => SessionRecord;
  get: (session: string) => SessionRecord;
  // Every session, archived ones included, each saying whether its worktree is still there.
  list: () => SessionSummary[];
  setState: (session: string, state: SessionState) => void;
  // Null forgets the id: the next spawn starts a fresh agent context (sessions.clear).
  setAgentSessionId: (session: string, id: string | null) => void;
  setTitle: (session: string, title: string) => void;
  setArchived: (session: string, archived: boolean) => void;
}

export interface SessionStoreOptions {
  db: DatabaseSync;
  lastSeq: (session: string) => number;
  now?: () => Date;
  // Whether a worktree path is still on disk; the default asks the filesystem.
  worktreeExists?: (path: string) => boolean;
}

const agentOf = (value: unknown): AgentKind => (value === 'pi' ? 'pi' : 'claude');

const stateOf = (value: unknown): SessionState => {
  switch (value) {
    case 'running':
    case 'waiting_user':
    case 'ended':
      return value;
    default:
      return 'idle';
  }
};

const columns =
  'session, title, repo, worktree, branch, base, agent, agent_session_id, state, archived, created_at, updated_at';

const toRecord = (row: Record<string, unknown>, lastSeq: number): SessionRecord => ({
  session: String(row['session']),
  title: String(row['title']),
  repo: String(row['repo']),
  worktree: String(row['worktree']),
  branch: String(row['branch']),
  base: String(row['base']),
  agent: agentOf(row['agent']),
  agentSessionId: typeof row['agent_session_id'] === 'string' ? row['agent_session_id'] : null,
  state: stateOf(row['state']),
  archived: row['archived'] === 1,
  lastSeq,
  createdAt: String(row['created_at']),
  updatedAt: String(row['updated_at']),
});

const toSummary = (record: SessionRecord, worktreeExists: boolean): SessionSummary => ({
  session: record.session,
  title: record.title,
  repo: record.repo,
  branch: record.branch,
  agent: record.agent,
  state: record.state,
  lastSeq: record.lastSeq,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  archived: record.archived,
  worktreeExists,
});

const prepareStatements = (db: DatabaseSync) => {
  const update = (column: string) =>
    db.prepare(`UPDATE sessions SET ${column} = ?, updated_at = ? WHERE session = ?`);
  return {
    insert: db.prepare(
      `INSERT INTO sessions (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'idle', 0, ?, ?)`,
    ),
    select: db.prepare(`SELECT ${columns} FROM sessions WHERE session = ?`),
    selectAll: db.prepare(`SELECT ${columns} FROM sessions ORDER BY updated_at DESC`),
    state: update('state'),
    agentSessionId: update('agent_session_id'),
    title: update('title'),
    archived: update('archived'),
  };
};

type Statements = ReturnType<typeof prepareStatements>;

// One column of one row updated, with the timestamp; a missing row is `not_found`.
const setter =
  (now: () => Date) =>
  (statement: Statements['state'], session: string, value: string | number | null): void => {
    const changed = statement.run(value, now().toISOString(), session).changes;
    if (changed === 0) throw new DaemonError('not_found', `no session ${session}`);
  };

export const createSessionStore = (options: SessionStoreOptions): SessionStore => {
  const { db, lastSeq } = options;
  const now = options.now ?? ((): Date => new Date());
  const worktreeExists = options.worktreeExists ?? existsSync;
  const st = prepareStatements(db);
  const set = setter(now);
  const record = (row: Record<string, unknown>): SessionRecord =>
    toRecord(row, lastSeq(String(row['session'])));

  const get = (session: string): SessionRecord => {
    const row = st.select.get(session);
    if (row === undefined) throw new DaemonError('not_found', `no session ${session}`);
    return record(row);
  };

  const create = (input: NewSession): SessionRecord => {
    const ts = now().toISOString();
    const { session, title, repo, worktree, branch, base, agent } = input;
    st.insert.run(session, title, repo, worktree, branch, base, agent, ts, ts);
    return get(session);
  };

  const summary = (row: Record<string, unknown>): SessionSummary => {
    const r = record(row);
    return toSummary(r, worktreeExists(r.worktree));
  };

  return {
    create,
    get,
    list: () => st.selectAll.all().map((row) => summary(row)),
    setState: (session, state) => {
      set(st.state, session, state);
    },
    setAgentSessionId: (session, id) => {
      set(st.agentSessionId, session, id);
    },
    setTitle: (session, title) => {
      set(st.title, session, title);
    },
    setArchived: (session, archived) => {
      set(st.archived, session, archived ? 1 : 0);
    },
  };
};
