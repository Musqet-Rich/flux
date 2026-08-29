import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { sessionHarness as setup } from '../test/session-harness.ts';

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

const untilState = (emitted: FluxEvent[], state: string): Promise<FluxEvent> =>
  until(emitted, (e) => e.type === 'session.state' && e.payload.state === state);

test('a user message runs a turn and the log tells the whole story', async () => {
  const { supervisor, log, sessions, emitted, ephemeral, worktree } = await setup();
  const seq = await supervisor.send('do the thing');
  expect(seq).toBe(1);
  expect(supervisor.state()).toBe('running');
  await untilEvent(emitted, 'turn.ended');
  await untilEvent(emitted, 'session.state', 3);
  const types = log.read('s1', 0).events.map((e) => e.type);
  expect(types.slice(0, 2)).toEqual(['msg.user', 'session.state']);
  expect(types).toContain('msg.assistant');
  expect(types).toContain('tool.start');
  expect(types).toContain('files.changed');
  expect(types.at(-2)).toBe('turn.ended');
  expect(types.at(-1)).toBe('session.state');
  expect(supervisor.state()).toBe('idle');
  expect(sessions.get('s1').agentSessionId).toBe('86845ede-f4a6-4fc1-a5fb-b6aa1705796b');
  const files = emitted.find((e) => e.type === 'files.changed');
  expect(files?.payload).toEqual({ files: [{ path: 'notes.txt', status: 'A' }] });
  expect(ephemeral[0]).toMatchObject({ type: 'delta', session: 's1', text: 'Re' });
  expect(emitted.map((e) => e.seq)).toEqual(log.read('s1', 0).events.map((e) => e.seq));
  expect(worktree).toContain('flux-sup-');
  await supervisor.close();
});

test('a second message reuses the process and refs are rendered from the worktree', async () => {
  const { supervisor, log, emitted, spawns } = await setup();
  await supervisor.send('first');
  await untilEvent(emitted, 'turn.ended');
  const seq = await supervisor.send(
    'now this',
    [{ path: 'notes.txt', rev: 'worktree', range: { startLine: 1, endLine: 1 } }],
    ['c1'],
  );
  const user = log.read('s1', seq - 1, 1).events[0];
  expect(user?.payload).toEqual({
    text: 'now this',
    refs: [{ path: 'notes.txt', rev: 'worktree', range: { startLine: 1, endLine: 1 } }],
    commentIds: ['c1'],
  });
  await untilEvent(emitted, 'turn.ended', seq);
  expect(spawns).toHaveLength(1);
  await supervisor.close();
});

test('an agent that dies ends the session, and the next message resumes it', async () => {
  const { supervisor, sessions, emitted, spawns } = await setup({
    FLUX_FAKE_EXIT_AFTER_TURNS: '1',
  });
  await supervisor.send('first');
  const ended = await untilState(emitted, 'ended');
  expect(ended.payload).toEqual({ state: 'ended', reason: 'agent exited with 1' });
  expect(sessions.get('s1').state).toBe('ended');
  await supervisor.send('again');
  expect(spawns).toHaveLength(2);
  expect(spawns[1]?.resume).toBe('86845ede-f4a6-4fc1-a5fb-b6aa1705796b');
  expect(supervisor.state()).toBe('running');
  await supervisor.close();
});

test('interrupt kills the agent', async () => {
  const { supervisor, emitted } = await setup();
  await supervisor.send('first');
  supervisor.interrupt();
  const ended = await untilState(emitted, 'ended');
  expect(ended.payload).toEqual({ state: 'ended', reason: 'agent killed' });
  await supervisor.close();
});
