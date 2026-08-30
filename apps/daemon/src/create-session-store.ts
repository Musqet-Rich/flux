import type { AgentTools, HarnessKind, SessionState, SessionSummary } from '@flux/protocol';
import { settings } from '@flux/protocol';
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
  // The resolved Agent role (ADR 0023 § 2), persisted at create and compiled to an appended
  // system prompt on spawn. Daemon-internal, not on `SessionSummary`; absent when none was set.
  role?: string;
  // The resolved Agent tool policy (ADR 0023 § 4), persisted at create as JSON text and compiled
  // to Claude flags on spawn, so a restart re-spawns identically. Daemon-internal, not on the
  // wire summary; absent when the Agent set none (mode `all`).
  tools?: AgentTools;
  // The resolved Agent `manager` flag (ADR 0025), persisted at create so the authorisation check
  // (create-control-handler.ts) is stable across a restart even if the Agent is later edited.
  // Daemon-internal, not on the wire summary; absent (never false) when the Agent is not a manager.
  manager?: boolean;
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
  harness: HarnessKind;
  // Configured model and effort (ADR 0023 § 3); omitted when the box spawns on its defaults.
  model?: string;
  effort?: string;
  // The resolved Agent role (ADR 0023 § 2); omitted when no Agent set one.
  role?: string;
  // The resolved Agent tool policy (ADR 0023 § 4); omitted when the Agent set none.
  tools?: AgentTools;
  // The resolved Agent `manager` flag (ADR 0025); omitted (never false) for an ordinary Agent.
  manager?: boolean;
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

// The `agent` column predates ADR 0023 and stores the harness value (`claude`/`pi`); the value
// does not migrate, so the column keeps its name while the field is `harness`.
const harnessOf = (value: unknown): HarnessKind => (value === 'pi' ? 'pi' : 'claude');

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

// exactOptionalPropertyTypes: omit `model`/`effort` entirely when unset, never set them to
// `undefined`.
const optionals = (model: string | undefined, effort: string | undefined) => ({
  ...(model === undefined ? {} : { model }),
  ...(effort === undefined ? {} : { effort }),
});

// The tool policy is stored as JSON text; a row from before this shipped, or any value that no
// longer parses to a valid policy, reads back as none (mode `all`) rather than failing the read.
const toolsField = (value: unknown): { tools?: AgentTools } => {
  if (typeof value !== 'string' || value.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  return settings.isTools(parsed) ? { tools: parsed } : {};
};

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
  'session, title, repo, worktree, branch, base, agent, model, effort, role, tools, manager, agent_session_id, state, archived, created_at, updated_at';

// The insert's bound values in column order; optional fields become NULL when unset. The tool
// policy is serialised to JSON text.
const insertParams = (i: NewSession, ts: string): (string | number | null)[] => [
  i.session,
  i.title,
  i.repo,
  i.worktree,
  i.branch,
  i.base,
  i.harness,
  i.model ?? null,
  i.effort ?? null,
  i.role ?? null,
  i.tools === undefined ? null : JSON.stringify(i.tools),
  i.manager === true ? 1 : null,
  ts,
  ts,
];

const toRecord = (row: Record<string, unknown>, lastSeq: number): SessionRecord => ({
  session: String(row['session']),
  title: String(row['title']),
  repo: String(row['repo']),
  worktree: String(row['worktree']),
  branch: String(row['branch']),
  base: String(row['base']),
  harness: harnessOf(row['agent']),
  ...optionals(stringOrUndefined(row['model']), stringOrUndefined(row['effort'])),
  ...(stringOrUndefined(row['role']) === undefined ? {} : { role: String(row['role']) }),
  ...toolsField(row['tools']),
  ...(row['manager'] === 1 ? { manager: true } : {}),
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
  harness: record.harness,
  ...optionals(record.model, record.effort),
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
      `INSERT INTO sessions (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'idle', 0, ?, ?)`,
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
    st.insert.run(...insertParams(input, now().toISOString()));
    return get(input.session);
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
