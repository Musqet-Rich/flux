import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { piFixture, piHarness as setup } from '../../test/pi-harness.ts';

// The supervisor driving the fake pi end to end: send, stream, tools, cost, interrupt, resume.

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

test('a reply streams, a tool call is rendered, the turn ends with cost and the session goes idle', async () => {
  const { supervisor, log, emitted, ephemeral, spawns } = await setup(['tools']);
  const seq = await supervisor.send('look around');
  expect(seq).toBe(1);
  expect(supervisor.state()).toBe('running');
  await untilEvent(emitted, 'turn.ended');
  await untilState(emitted, 'idle');
  const events = log.read('s1', 0).events;
  expect(events.map((e) => e.type)).toEqual([
    'msg.user',
    'session.state',
    'tool.start',
    'tool.start',
    'tool.end',
    'tool.end',
    'files.changed',
    'msg.assistant',
    'turn.ended',
    'session.state',
  ]);
  expect(events[2]?.payload).toMatchObject({ name: 'read', summary: 'read notes.txt' });
  expect(events[8]?.payload).toMatchObject({
    costUsd: expect.any(Number),
    numTurns: 2,
    usage: { input: expect.any(Number) },
  });
  const ended = events[8] as { payload: { costUsd: number } };
  expect(ended.payload.costUsd).toBeGreaterThan(0);
  expect(ephemeral.some((m) => m.type === 'delta')).toBe(true);
  expect(spawns).toEqual([{ cwd: expect.any(String), session: 's1' }]);
  expect(supervisor.state()).toBe('idle');
  await supervisor.close();
});

test('interrupt aborts the run in place: the turn ends as aborted and the process is reused', async () => {
  const { supervisor, emitted, spawns } = await setup(['interrupt', 'text-reply']);
  await supervisor.send('count');
  supervisor.interrupt();
  const ended = await untilEvent(emitted, 'turn.ended');
  expect(ended.payload).toMatchObject({ stopReason: 'aborted' });
  await untilState(emitted, 'idle');
  await supervisor.send('again');
  await untilEvent(emitted, 'turn.ended', ended.seq);
  expect(spawns).toHaveLength(1);
  await supervisor.close();
});

test('a pi that dies ends the session, and the next message respawns with the same session id', async () => {
  const { supervisor, sessions, emitted, spawns } = await setup(['text-reply'], {
    FLUX_FAKE_EXIT_AFTER_TURNS: '1',
    FLUX_FAKE_STDERR_FILE: piFixture('bad-model').replace(/\.jsonl$/u, '.stderr.txt'),
  });
  await supervisor.send('first');
  const ended = await untilState(emitted, 'ended');
  expect(ended.payload).toEqual({
    state: 'ended',
    reason: expect.stringContaining('agent exited with 1: '),
  });
  expect(ended.payload).toEqual({
    state: 'ended',
    reason: expect.stringContaining('Model "no-such-model" not found'),
  });
  expect(sessions.get('s1').state).toBe('ended');
  await supervisor.send('again');
  expect(spawns.map((s) => s.session)).toEqual(['s1', 's1']);
  expect(supervisor.state()).toBe('running');
  await supervisor.close();
});

test('a failed model call is logged raw and still ends the turn', async () => {
  const { supervisor, log, emitted } = await setup(['bad-model']);
  await supervisor.send('hi');
  await untilState(emitted, 'idle');
  const types = log.read('s1', 0).events.map((e) => e.type);
  expect(types).toEqual(['msg.user', 'session.state', 'raw', 'turn.ended', 'session.state']);
  await supervisor.close();
});

test('interrupt while waiting on a flux_ask settles the run and the session goes idle', async () => {
  const { supervisor, emitted, spawns } = await setup(['interrupt', 'text-reply']);
  await supervisor.send('ask me');
  supervisor.waiting(true);
  await untilState(emitted, 'waiting_user');
  supervisor.interrupt();
  const ended = await untilEvent(emitted, 'turn.ended');
  expect(ended.payload).toMatchObject({ stopReason: 'aborted' });
  await untilState(emitted, 'idle');
  expect(supervisor.state()).toBe('idle');
  expect(spawns).toHaveLength(1);
  await supervisor.close();
});
