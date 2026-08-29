import type { AgentKind, SessionState, SessionSummary } from '@flux/protocol';
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
  list: () => SessionSummary[];
  setState: (session: string, state: SessionState) => void;
  setAgentSessionId: (session: string, id: string) => void;
  setTitle: (session: string, title: string) => void;
  setArchived: (session: string, archived: boolean) => void;
}

export interface SessionStoreOptions {
  db: DatabaseSync;
  lastSeq: (session: string) => number;
  now?: () => Date;
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

const toSummary = (record: SessionRecord): SessionSummary => ({
  session: record.session,
  title: record.title,
  repo: record.repo,
  branch: record.branch,
  agent: record.agent,
  state: record.state,
  lastSeq: record.lastSeq,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const prepareStatements = (db: DatabaseSync) => {
  const update = (column: string) =>
    db.prepare(`UPDATE sessions SET ${column} = ?, updated_at = ? WHERE session = ?`);
  return {
    insert: db.prepare(
      `INSERT INTO sessions (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'idle', 0, ?, ?)`,
    ),
    select: db.prepare(`SELECT ${columns} FROM sessions WHERE session = ?`),
    selectAll: db.prepare(
      `SELECT ${columns} FROM sessions WHERE archived = 0 ORDER BY updated_at DESC`,
    ),
    state: update('state'),
    agentSessionId: update('agent_session_id'),
    title: update('title'),
    archived: update('archived'),
  };
};

export const createSessionStore = (options: SessionStoreOptions): SessionStore => {
  const { db, lastSeq } = options;
  const now = options.now ?? ((): Date => new Date());
  const st = prepareStatements(db);
  const record = (row: Record<string, unknown>): SessionRecord =>
    toRecord(row, lastSeq(String(row['session'])));

  const get = (session: string): SessionRecord => {
    const row = st.select.get(session);
    if (row === undefined) throw new DaemonError('not_found', `no session ${session}`);
    return record(row);
  };

  const set = (statement: typeof st.state, session: string, value: string | number): void => {
    const changed = statement.run(value, now().toISOString(), session).changes;
    if (changed === 0) throw new DaemonError('not_found', `no session ${session}`);
  };

  const create = (input: NewSession): SessionRecord => {
    const ts = now().toISOString();
    const { session, title, repo, worktree, branch, base, agent } = input;
    st.insert.run(session, title, repo, worktree, branch, base, agent, ts, ts);
    return get(session);
  };

  return {
    create,
    get,
    list: () => st.selectAll.all().map((row) => toSummary(record(row))),
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
