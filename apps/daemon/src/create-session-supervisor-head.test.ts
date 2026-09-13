import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { rmSync } from 'node:fs';

import { gitIn } from '../test/git-in.ts';
import { sessionHarness as setup } from '../test/session-harness.ts';
import type { EventLog } from './create-event-log.ts';
import type { AgentAdapter } from './create-session-supervisor.ts';

// Where HEAD is, followed by the supervisor (create-session-supervisor.ts `checkHead`): the
// device's label is the worktree's branch, not the one the session began on.

// Resolves once an event matching the predicate has been emitted (after the ones already seen).
const until = (
  emitted: FluxEvent[],
  match: (e: FluxEvent) => boolean,
  after = 0,
): Promise<FluxEvent> =>
  new Promise((resolve) => {
    const check = (): void => {
      const found = emitted.slice(after).find((e) => match(e));
      if (found) resolve(found);
      else setImmediate(check);
    };
    check();
  });

const untilEvent = (emitted: FluxEvent[], type: string, after = 0): Promise<FluxEvent> =>
  until(emitted, (e) => e.type === type, after);

const untilState = (emitted: FluxEvent[], state: string, after = 0): Promise<FluxEvent> =>
  until(
    emitted,
    (e) => fluxEvent.isKnown(e) && e.type === 'session.state' && e.payload.state === state,
    after,
  );

// An adapter that ends the turn on every line and maps nothing else.
const ending = (): AgentAdapter => ({
  mapLine: () => ({ events: [], turnEnded: true }),
  reset: () => {},
});

const switchTo = (worktree: string, branch: string): void => {
  gitIn(worktree, ['switch', '-q', '-c', branch]);
};
const moves = (log: EventLog): unknown[] =>
  log
    .read('s1', 0)
    .events.filter((e) => e.type === 'session.head')
    .map((e) => e.payload);

// The branch on the device is the worktree's, not the one the session began on: the check
// runs when a turn ends, and logs only a move. The record keeps the created branch, the one
// archive deletes, and puts HEAD beside it.
test('a branch the agent switched to is logged and put on the record', async () => {
  const { supervisor, log, sessions, emitted, worktree } = await setup();
  const created = sessions.get('s1').branch;
  await supervisor.send('one');
  await untilState(emitted, 'idle');
  switchTo(worktree, 'feat/x');
  await supervisor.send('two');
  await untilEvent(emitted, 'session.head');
  expect(sessions.get('s1')).toMatchObject({ branch: created, head: 'feat/x' });
  const seen = emitted.length;
  await supervisor.send('three');
  await untilState(emitted, 'idle', seen);
  expect(moves(log)).toEqual([{ head: 'feat/x' }]);
  expect(created).not.toBe('feat/x');
  await supervisor.close();
});

// Between agents the operator may move HEAD on the box: the check before the spawn logs the
// move ahead of the message, so the timeline reads in the order things happened.
test('a move made while no agent ran is logged before the message that spawns one', async () => {
  const { supervisor, log, emitted, worktree } = await setup();
  await supervisor.send('one');
  await untilState(emitted, 'idle');
  await supervisor.close();
  switchTo(worktree, 'feat/y');
  await supervisor.send('two');
  await untilState(emitted, 'idle');
  const types = log.read('s1', 0).events.map((e) => e.type);
  expect(types.indexOf('session.head')).toBe(types.lastIndexOf('msg.user') - 1);
  await supervisor.close();
});

// Two messages arriving together with no agent to go to wait on one check between them, so
// the move is logged once, ahead of both, and the messages keep the order they came in.
test('messages arriving together share the check and keep their order', async () => {
  const { supervisor, log, emitted, worktree } = await setup();
  await supervisor.send('one');
  await untilState(emitted, 'idle');
  await supervisor.close();
  switchTo(worktree, 'feat/w');
  const seen = emitted.length;
  await Promise.all([supervisor.send('two'), supervisor.send('three')]);
  await untilState(emitted, 'idle', seen);
  const rows = log
    .read('s1', 0)
    .events.slice(seen)
    .filter((e) => ['session.head', 'msg.user'].includes(e.type));
  expect(rows.map((e) => [e.type, e.payload])).toEqual([
    ['session.head', { head: 'feat/w' }],
    ['msg.user', { text: 'two' }],
    ['msg.user', { text: 'three' }],
  ]);
  expect(moves(log)).toEqual([{ head: 'feat/w' }]);
  await supervisor.close();
});

// A close (archive, restart) that lands while a message waits on its check: the message is
// refused, not logged and spawned behind the close, where nothing would ever close the agent.
test('a message still preparing when the session closes is refused, not spawned', async () => {
  const { supervisor, log, emitted, spawns } = await setup();
  await supervisor.send('one');
  await untilState(emitted, 'idle');
  await supervisor.close();
  const pending = supervisor.send('two');
  await supervisor.close();
  await expect(pending).rejects.toMatchObject({ code: 'conflict' });
  expect(spawns).toHaveLength(1);
  expect(log.read('s1', 0).events.filter((e) => e.type === 'msg.user')).toHaveLength(1);
});

// A worktree gone from disk cannot say where HEAD is; the record stays as it was. (Scripted:
// the fixture's file write would have `git status` fail in the gone worktree first.)
test('a worktree that is gone leaves the branch on record alone', async () => {
  const { supervisor, log, sessions, emitted, worktree } = await setup({}, ending());
  const created = sessions.get('s1').branch;
  await supervisor.send('one');
  await untilState(emitted, 'idle');
  rmSync(worktree, { recursive: true, force: true });
  const seen = emitted.length;
  await supervisor.send('two');
  await untilState(emitted, 'idle', seen);
  expect(sessions.get('s1')).toMatchObject({ branch: created });
  expect('head' in sessions.get('s1')).toBe(false);
  expect(moves(log)).toEqual([]);
  await supervisor.close();
});

// An adapter that moves HEAD as the agent's first line arrives and reports it as a vcs notice,
// so the move happens after the spawn's own check and only the notice can catch it. The
// worktree is the harness's, known once it is built, so it is read late.
const switchingAdapter = (at: { worktree: string }, branch: string): AgentAdapter => {
  let moved = false;
  return {
    mapLine: () => {
      if (moved) return { events: [] };
      moved = true;
      switchTo(at.worktree, branch);
      return { events: [], vcsChanged: 'checkout' };
    },
    reset: () => {},
  };
};

// The agent's own git notice (a commit, a push) is a moment HEAD may have moved too.
test('a vcs notice from the agent checks the branch as a turn end does', async () => {
  const at = { worktree: '' };
  const { supervisor, log, emitted, worktree } = await setup({}, switchingAdapter(at, 'feat/z'));
  at.worktree = worktree;
  await supervisor.send('go');
  await untilEvent(emitted, 'session.head');
  expect(moves(log)).toEqual([{ head: 'feat/z' }]);
  await supervisor.close();
});
