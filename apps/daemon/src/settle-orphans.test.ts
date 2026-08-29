import { expect, test } from 'vitest';

import { createEventLog } from './create-event-log.ts';
import { createSessionStore } from './create-session-store.ts';
import { openDatabase } from './open-database.ts';
import { settleOrphans } from './settle-orphans.ts';

const setup = () => {
  const db = openDatabase(':memory:');
  const log = createEventLog({ db });
  const sessions = createSessionStore({ db, lastSeq: log.lastSeq });
  const create = (session: string) =>
    sessions.create({
      session,
      title: 't',
      repo: '/r',
      worktree: '/w',
      branch: 'b',
      base: 'HEAD',
      agent: 'claude',
    });
  return { log, sessions, create };
};

const ask = (askId: string) => ({
  type: 'ask' as const,
  payload: { askId, question: 'q', timeoutAt: 'x' },
});

test('an unanswered ask in a waiting session is aborted and the session goes idle', () => {
  const { log, sessions, create } = setup();
  create('s1');
  log.append('s1', ask('a1'));
  log.append('s1', { type: 'ask.answered', payload: { askId: 'a1', answer: 'y', by: 'device' } });
  log.append('s1', ask('a2'));
  sessions.setState('s1', 'waiting_user');
  expect(settleOrphans({ log, sessions })).toEqual({ asks: 1, sessions: 1 });
  const tail = log.read('s1', 3).events.map((e) => [e.type, e.payload]);
  expect(tail).toEqual([
    ['ask.answered', { askId: 'a2', answer: '', by: 'aborted' }],
    ['session.state', { state: 'idle', reason: 'daemon restarted' }],
  ]);
  expect(sessions.get('s1').state).toBe('idle');
  expect(settleOrphans({ log, sessions })).toEqual({ asks: 0, sessions: 0 });
});

test('idle and ended sessions are left alone; a running one is settled across log pages', () => {
  const { log, sessions, create } = setup();
  create('idle');
  create('ended');
  create('running');
  log.append('idle', ask('never'));
  sessions.setState('ended', 'ended');
  for (let i = 0; i < 600; i += 1)
    log.append('running', { type: 'notify', payload: { level: 'info', summary: `${i}` } });
  log.append('running', ask('late'));
  sessions.setState('running', 'running');
  expect(settleOrphans({ log, sessions })).toEqual({ asks: 1, sessions: 1 });
  expect(log.lastSeq('idle')).toBe(1);
  expect(log.lastSeq('ended')).toBe(0);
  expect(log.read('running', 601).events.map((e) => e.type)).toEqual([
    'ask.answered',
    'session.state',
  ]);
  expect(sessions.get('running').state).toBe('idle');
});
