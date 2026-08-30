import type { AgentSpec, RpcMethods, SessionSummary } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createAskRegistry } from './create-ask-registry.ts';
import { createControlHandler } from './create-control-handler.ts';
import type { ControlRequest } from './create-control-socket.ts';
import { createEventLog } from './create-event-log.ts';
import { createSessionStore } from './create-session-store.ts';
import type { SessionRecord } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';
import { openDatabase } from './open-database.ts';

// The manager surface (ADR 0025) is driven through the real control handler, so the dispatch and
// the §5 authorisation are both exercised. The crown jewel: a non-manager caller is rejected on
// every verb — remove the `caller.manager` check in manager-control.ts and one of these goes red.

type OpenParams = RpcMethods['sessions.create']['params'];

const base = {
  title: 't',
  repo: '/r',
  worktree: '/w',
  branch: 'b',
  base: 'HEAD',
  harness: 'claude' as const,
};

const fakeSupervisor =
  (sends: { target: string; text: string }[]) =>
  (record: SessionRecord): SessionSupervisor => ({
    send: (text) => {
      sends.push({ target: record.session, text });
      return Promise.resolve(42);
    },
    waiting: () => {},
    interrupt: () => {},
    close: () => Promise.resolve(),
    kill: () => {},
    state: () => 'running',
  });

const fakeOpen =
  (opened: OpenParams[]) =>
  (params: OpenParams): Promise<SessionSummary> => {
    opened.push(params);
    const { title, branch, repo, harness } = params;
    return Promise.resolve({
      session: 'opened-1',
      title: title ?? branch,
      repo,
      branch,
      harness,
      state: 'idle',
      lastSeq: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
  };

const setup = (agents: AgentSpec[] = []) => {
  const db = openDatabase(':memory:');
  const log = createEventLog({ db });
  const sessions = createSessionStore({ db, lastSeq: log.lastSeq });
  // A manager caller, an ordinary caller, a target, and an archived session.
  sessions.create({ ...base, session: 'mgr', worktree: '/w/mgr', manager: true });
  sessions.create({ ...base, session: 'plain', worktree: '/w/plain' });
  sessions.create({ ...base, session: 's2', title: 'Worker', worktree: '/w/s2' });
  sessions.create({ ...base, session: 'arch', worktree: '/w/arch' });
  sessions.setArchived('arch', true);
  const emitted: { type: string; payload: unknown; session: string }[] = [];
  const sends: { target: string; text: string }[] = [];
  const opened: OpenParams[] = [];
  const archived: string[] = [];
  const handle = createControlHandler({
    log,
    sessions,
    asks: createAskRegistry(),
    supervisor: fakeSupervisor(sends),
    emit: (e) => {
      emitted.push({ type: e.type, payload: e.payload, session: e.session });
    },
    pairingUrl: () => 'u',
    revokeDevice: () => Promise.resolve(),
    openSession: fakeOpen(opened),
    archiveSession: (session) => {
      archived.push(session);
      sessions.setArchived(session, true);
      return Promise.resolve();
    },
    getAgents: () => agents,
  });
  return { handle, log, sessions, emitted, sends, opened, archived };
};

const acted = (emitted: { type: string }[]): number =>
  emitted.filter((e) => e.type === 'manager.acted').length;

// Each of the five verbs, once, built with the given caller session.
const verbs = (caller: string): ControlRequest[] => [
  { type: 'sessions.list', session: caller },
  { type: 'session.open', session: caller, repo: '/r', branch: 'x', harness: 'claude' },
  { type: 'session.send', session: caller, target: 's2', text: 'hi' },
  { type: 'session.close', session: caller, target: 's2' },
  { type: 'session.read', session: caller, target: 's2' },
];

test('a non-manager caller is rejected on every one of the five verbs', async () => {
  const { handle, emitted } = setup();
  await Promise.all(
    verbs('plain').map((request) => expect(handle(request)).rejects.toThrow(/not a manager/u)),
  );
  expect(acted(emitted)).toBe(0);
});

test('a caller the store does not know is rejected, not treated as a manager', async () => {
  const { handle } = setup();
  await expect(handle({ type: 'sessions.list', session: 'ghost' })).rejects.toThrow(/no session/u);
});

test('a manager lists the fleet without auditing anything', async () => {
  const { handle, emitted } = setup();
  const result = await handle({ type: 'sessions.list', session: 'mgr' });
  const sessions = (result as { sessions: { session: string; title: string }[] }).sessions;
  expect(sessions.map((s) => s.session).toSorted()).toEqual(['arch', 'mgr', 'plain', 's2']);
  expect(sessions.find((s) => s.session === 's2')).toMatchObject({
    title: 'Worker',
    harness: 'claude',
  });
  expect(acted(emitted)).toBe(0);
});

test('open calls the create op and audits manager.acted open to the new session', async () => {
  const { handle, emitted, opened } = setup();
  const result = await handle({
    type: 'session.open',
    session: 'mgr',
    repo: '/r',
    branch: 'feature',
    harness: 'claude',
    title: 'Sub-task',
  });
  expect(result).toEqual({ session: 'opened-1', title: 'Sub-task' });
  expect(opened).toEqual([{ repo: '/r', branch: 'feature', harness: 'claude', title: 'Sub-task' }]);
  const audit = emitted.find((e) => e.type === 'manager.acted');
  expect(audit).toMatchObject({
    session: 'opened-1',
    payload: { actor: 'mgr', action: 'open', target: 'opened-1' },
  });
});

test('open refuses to launch a manager Agent (§6)', async () => {
  const { handle, opened, emitted } = setup([{ name: 'boss', manager: true }]);
  await expect(
    handle({
      type: 'session.open',
      session: 'mgr',
      repo: '/r',
      branch: 'x',
      harness: 'claude',
      agent: 'boss',
    }),
  ).rejects.toThrow(/cannot open another manager/u);
  expect(opened).toEqual([]);
  expect(acted(emitted)).toBe(0);
});

test('send reaches the target supervisor and audits manager.acted send', async () => {
  const { handle, emitted, sends } = setup();
  const result = await handle({
    type: 'session.send',
    session: 'mgr',
    target: 's2',
    text: 'run tests',
  });
  expect(result).toEqual({ seq: 42 });
  expect(sends).toEqual([{ target: 's2', text: 'run tests' }]);
  expect(emitted.find((e) => e.type === 'manager.acted')).toMatchObject({
    session: 's2',
    payload: { actor: 'mgr', action: 'send', target: 's2', detail: 'run tests' },
  });
});

test('close archives the target through the shared op and audits manager.acted close', async () => {
  const { handle, emitted, archived, sessions } = setup();
  await handle({ type: 'session.close', session: 'mgr', target: 's2' });
  expect(archived).toEqual(['s2']);
  expect(sessions.get('s2').archived).toBe(true);
  expect(emitted.find((e) => e.type === 'manager.acted')).toMatchObject({
    session: 's2',
    payload: { actor: 'mgr', action: 'close', target: 's2' },
  });
});

test('read returns a digest of recent activity and audits manager.acted read', async () => {
  const { handle, log, emitted } = setup();
  log.append('s2', { type: 'msg.user', payload: { text: 'do the thing' } });
  log.append('s2', { type: 'msg.assistant', payload: { text: 'on it' } });
  log.append('s2', {
    type: 'tool.start',
    payload: { toolId: 't', name: 'Bash', input: {}, summary: 'Bash: ls' },
  });
  const result = await handle({ type: 'session.read', session: 'mgr', target: 's2' });
  const digest = (result as { digest: string }).digest;
  expect(digest).toContain('user: do the thing');
  expect(digest).toContain('assistant: on it');
  expect(digest).toContain('tool: Bash: ls');
  expect(emitted.find((e) => e.type === 'manager.acted')).toMatchObject({
    session: 's2',
    payload: { actor: 'mgr', action: 'read', target: 's2' },
  });
});

test('the mutating and reading verbs reject the caller targeting itself', async () => {
  const { handle } = setup();
  await expect(
    handle({ type: 'session.send', session: 'mgr', target: 'mgr', text: 'x' }),
  ).rejects.toThrow(/cannot target its own session/u);
  await expect(handle({ type: 'session.close', session: 'mgr', target: 'mgr' })).rejects.toThrow(
    /cannot target its own session/u,
  );
  await expect(handle({ type: 'session.read', session: 'mgr', target: 'mgr' })).rejects.toThrow(
    /cannot target its own session/u,
  );
});

test('send, close and read reject an unknown target', async () => {
  const { handle } = setup();
  await expect(
    handle({ type: 'session.send', session: 'mgr', target: 'nope', text: 'x' }),
  ).rejects.toThrow(/no session/u);
  await expect(handle({ type: 'session.close', session: 'mgr', target: 'nope' })).rejects.toThrow(
    /no session/u,
  );
  await expect(handle({ type: 'session.read', session: 'mgr', target: 'nope' })).rejects.toThrow(
    /no session/u,
  );
});

test('send and close reject an already-archived target', async () => {
  const { handle } = setup();
  await expect(
    handle({ type: 'session.send', session: 'mgr', target: 'arch', text: 'x' }),
  ).rejects.toThrow(/archived/u);
  await expect(handle({ type: 'session.close', session: 'mgr', target: 'arch' })).rejects.toThrow(
    /already archived/u,
  );
});
