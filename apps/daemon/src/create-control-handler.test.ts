import { expect, test } from 'vitest';

import { createAskRegistry } from './create-ask-registry.ts';
import { createControlHandler } from './create-control-handler.ts';
import { createEventLog } from './create-event-log.ts';
import { createSessionStore } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';
import { openDatabase } from './open-database.ts';

// The handler behind the control socket, with a recording supervisor: an ask parks the session
// in waiting_user and an interrupted agent (its socket gone) releases it as aborted.

const setup = () => {
  const db = openDatabase(':memory:');
  const log = createEventLog({ db });
  const sessions = createSessionStore({ db, lastSeq: log.lastSeq });
  sessions.create({
    session: 's1',
    title: 't',
    repo: '/r',
    worktree: '/w',
    branch: 'b',
    base: 'HEAD',
    agent: 'pi',
  });
  const waiting: boolean[] = [];
  const supervisor: SessionSupervisor = {
    send: () => Promise.resolve(1),
    waiting: (on) => {
      waiting.push(on);
    },
    interrupt: () => {},
    close: () => Promise.resolve(),
    state: () => 'running',
  };
  const handle = createControlHandler({
    log,
    sessions,
    asks: createAskRegistry(),
    supervisor: () => supervisor,
    emit: () => {},
    pairingUrl: () => 'u',
    revokeDevice: () => Promise.resolve(),
  });
  return { handle, log, waiting };
};

test('an ask whose connection drops is answered as aborted and the session stops waiting', async () => {
  const { handle, log, waiting } = setup();
  const gone = new AbortController();
  const asked = handle({ type: 'ask', session: 's1', question: 'go on?' }, gone.signal);
  gone.abort();
  expect(await asked).toEqual({ answer: '', by: 'aborted' });
  expect(waiting).toEqual([true, false]);
  const events = log.read('s1', 0).events;
  expect(events[0]?.type).toBe('ask');
  expect(events[1]).toMatchObject({
    type: 'ask.answered',
    payload: { askId: expect.any(String), answer: '', by: 'aborted' },
  });
});
