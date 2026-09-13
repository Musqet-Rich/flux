import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessionHarness as setup } from '../test/session-harness.ts';
import { transcriptPath } from './claude/transcript-path.ts';
import type { EventLog } from './create-event-log.ts';
import type { AgentAdapter, Mapped } from './create-session-supervisor.ts';

const stubborn = fileURLToPath(new URL('../test/stubborn-agent.ts', import.meta.url));

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

const untilLength = (list: unknown[], n: number): Promise<void> =>
  new Promise((resolve) => {
    const check = (): void => {
      if (list.length >= n) resolve();
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
  expect(ephemeral.find((e) => e.type === 'delta')).toMatchObject({
    type: 'delta',
    session: 's1',
    text: 'Re',
  });
  expect(ephemeral.find((e) => e.type === 'agent.context')).toMatchObject({
    type: 'agent.context',
    session: 's1',
    model: 'claude-fable-5',
    window: 1_000_000,
  });
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
    { seq: 1, from: 'user', text: 'first' },
  );
  const user = log.read('s1', seq - 1, 1).events[0];
  expect(user?.payload).toEqual({
    text: 'now this',
    refs: [{ path: 'notes.txt', rev: 'worktree', range: { startLine: 1, endLine: 1 } }],
    commentIds: ['c1'],
    replyTo: 1,
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

// sessions.clear: the id is forgotten in the store, so the supervisor made for the next message
// spawns without --resume and the agent starts a fresh context in the same worktree.
test('a forgotten agent session id makes the next message spawn without resume', async () => {
  const { supervisor, sessions, emitted, spawns, reopen } = await setup();
  await supervisor.send('first');
  await untilEvent(emitted, 'turn.ended');
  expect(sessions.get('s1').agentSessionId).not.toBeNull();
  await supervisor.close();
  sessions.setAgentSessionId('s1', null);
  const fresh = reopen();
  await fresh.send('again');
  expect(spawns).toHaveLength(2);
  expect(spawns[1]?.resume).toBeUndefined();
  await fresh.close();
});

test('interrupt kills the agent', async () => {
  const { supervisor, emitted } = await setup();
  await supervisor.send('first');
  supervisor.interrupt();
  const ended = await untilState(emitted, 'ended');
  expect(ended.payload).toEqual({ state: 'ended', reason: 'agent killed' });
  await supervisor.close();
});

// The thinking indicator and a git state change are ephemeral (protocol.md § 6): the supervisor
// sends them on the session and logs nothing. A stub adapter stands in for a mapping the
// replayed fixture cannot produce on its own.
const signals: Mapped[] = [
  { events: [], context: { tokens: 238560, model: 'claude-fable-5' } },
  { events: [], context: { tokens: 300, model: 'mystery' } },
  { events: [], thinking: { active: true, estimatedTokens: 120 } },
  { events: [], vcsChanged: 'push' },
];

// One reply per line the fake agent prints, then the turn ends.
const scripted = (replies: Mapped[] = [...signals]): AgentAdapter => ({
  mapLine: () => replies.shift() ?? { events: [], thinking: { active: false }, turnEnded: true },
  reset: () => {},
});

test('thinking and vcs signals go out as ephemerals and never touch the log', async () => {
  const { supervisor, log, ephemeral, emitted } = await setup({}, scripted());
  await supervisor.send('go');
  await untilLength(ephemeral, 5);
  await untilState(emitted, 'idle');
  // The supervisor names the window from the table; an unknown model gets none.
  expect(ephemeral.slice(0, 5)).toEqual([
    {
      type: 'agent.context',
      session: 's1',
      tokens: 238560,
      model: 'claude-fable-5',
      window: 1_000_000,
    },
    { type: 'agent.context', session: 's1', tokens: 300, model: 'mystery' },
    { type: 'agent.thinking', session: 's1', active: true, estimatedTokens: 120 },
    { type: 'vcs.changed', session: 's1', kind: 'push' },
    { type: 'agent.thinking', session: 's1', active: false },
  ]);
  expect(log.read('s1', 0).events.map((e) => e.type)).toEqual([
    'msg.user',
    'session.state',
    'session.state',
  ]);
  await supervisor.close();
});

// Closing is deliberate (stop, archive, restart): a session caught mid-turn is idle afterwards,
// not running for ever, so the PWA's status is truthful and the next message resumes it.
test('close leaves a running session idle, with the reason logged', async () => {
  const silent: AgentAdapter = { mapLine: () => ({ events: [] }), reset: () => {} };
  const { supervisor, log, sessions } = await setup({}, silent);
  await supervisor.send('go');
  expect(supervisor.state()).toBe('running');
  await supervisor.close();
  expect(supervisor.state()).toBe('idle');
  expect(sessions.get('s1').state).toBe('idle');
  expect(log.read('s1', 0).events.at(-1)?.payload).toEqual({
    state: 'idle',
    reason: 'agent closed',
  });
});

// A shutdown that cannot wait: kill is SIGKILL of the agent's group, so an agent that ignores
// EOF and SIGTERM (blocked in an MCP call) is gone at once; it is deliberate, so no `ended`.
test('kill ends a stubborn agent without waiting, deliberately', async () => {
  const silent: AgentAdapter = { mapLine: () => ({ events: [] }), reset: () => {} };
  const { supervisor, log, agents } = await setup({}, silent, stubborn);
  await supervisor.send('go');
  const exit = new Promise<number | null>((resolve) => {
    agents[0]?.onExit(resolve);
  });
  supervisor.kill();
  expect(await exit).toBeNull();
  await supervisor.close();
  expect(supervisor.state()).toBe('idle');
  expect(log.read('s1', 0).events.map((e) => e.payload)).not.toContainEqual(
    expect.objectContaining({ state: 'ended' }),
  );
});

const imageFixture = fileURLToPath(
  new URL('../test/fixtures/claude/session-image-block.jsonl', import.meta.url),
);
const png = fileURLToPath(new URL('../test/red.png', import.meta.url));

// The attached files are logged on the message and rendered into the prompt; an image within
// the block limit is flagged so the device knows a thumbnail is worth fetching. The fixture is
// the real binary's answer to that prompt with the image block.
test('attachments are logged on the message, listed in the prompt and images flagged', async () => {
  const { supervisor, log, emitted } = await setup({ FLUX_FAKE_FIXTURE: imageFixture });
  const seq = await supervisor.send('What colour?', [], [], null, [
    { id: 'a1', name: 'red.png', mime: 'image/png', size: 75, path: png },
    { id: 'a2', name: 'notes.txt', mime: 'text/plain', size: 5, path: '/nowhere/notes.txt' },
  ]);
  const user = log.read('s1', seq - 1, 1).events[0];
  expect(user?.payload).toEqual({
    text: 'What colour?',
    attachments: [
      { id: 'a1', name: 'red.png', mime: 'image/png', size: 75, image: true },
      { id: 'a2', name: 'notes.txt', mime: 'text/plain', size: 5, image: false },
    ],
  });
  const reply = await untilEvent(emitted, 'msg.assistant');
  expect(reply.payload).toEqual({ text: 'red' });
  await supervisor.close();
});

// The running spec (protocol.md § 5 `agent.spec`) is logged when it changes, not on every line
// that names the model: the fixture's init and each message_start all say `claude-fable-5`,
// and the scratch config dir holds no transcript, so two turns log one row, the model alone.
test('the running spec is logged once until it changes', async () => {
  const { supervisor, log, emitted } = await setup();
  await supervisor.send('first');
  await untilEvent(emitted, 'turn.ended');
  await supervisor.send('second');
  await untilEvent(emitted, 'turn.ended', emitted.length);
  const specs = log.read('s1', 0).events.filter((e) => e.type === 'agent.spec');
  expect(specs.map((e) => e.payload)).toEqual([{ model: 'claude-fable-5' }]);
  // Logged at the first model call, before the first reply.
  const types = log.read('s1', 0).events.map((e) => e.type);
  expect(types.indexOf('agent.spec')).toBeLessThan(types.indexOf('msg.assistant'));
  await supervisor.close();
});

// The transcript the fake agent's init line points at (its cwd slugged under the config dir,
// its session id), planted from the captured transcript so the turn's end finds an effort.
const fixtureCwd =
  '/private/tmp/claude-501/-Users-richhenderson-code-flux/73ccd0c9-0938-49eb-9548-e002f2d31a8d/scratchpad/fixture-repo';
const plantTranscript = (configDir: string): void => {
  const path = transcriptPath(fixtureCwd, '86845ede-f4a6-4fc1-a5fb-b6aa1705796b', configDir);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(
    new URL('../test/fixtures/claude/transcript-two-turns.jsonl', import.meta.url),
    path,
  );
};

// Claude names the configured model on every prompt's `init` (`claude-haiku-4-5`) and the
// resolved one on `message_start` (`claude-haiku-4-5-20251001`); only the latter is the spec,
// so a turn logs one row, not one per name.
test('the spec is the resolved model of the call, not the configured name on init', async () => {
  const fixture = fileURLToPath(
    new URL('../test/fixtures/claude/session-image-block.jsonl', import.meta.url),
  );
  const { supervisor, log, emitted } = await setup({ FLUX_FAKE_FIXTURE: fixture });
  await supervisor.send('look');
  await untilEvent(emitted, 'turn.ended');
  expect(specsOf(log)).toEqual([{ model: 'claude-haiku-4-5-20251001' }]);
  await supervisor.close();
});

const specsOf = (log: EventLog): unknown[] =>
  log
    .read('s1', 0)
    .events.filter((e) => e.type === 'agent.spec')
    .map((e) => e.payload);

test('the effort joins the spec at the turn end, and a fresh daemon logs nothing new', async () => {
  const box = await setup();
  plantTranscript(box.configDir);
  await box.supervisor.send('first');
  await untilEvent(box.emitted, 'turn.ended');
  expect(specsOf(box.log)).toEqual([
    { model: 'claude-fable-5' },
    { model: 'claude-fable-5', effort: 'high' },
  ]);
  await box.supervisor.close();
  // A new supervisor over the same log (a daemon restart) picks the spec up from the log: the
  // respawned agent's init names the model alone, which is no change, and its turn end reads
  // the same effort.
  const again = box.reopen();
  const before = box.emitted.length;
  await again.send('second');
  await untilEvent(box.emitted, 'turn.ended', before);
  expect(specsOf(box.log)).toEqual([
    { model: 'claude-fable-5' },
    { model: 'claude-fable-5', effort: 'high' },
  ]);
  await again.close();
});

// The supervisor's change check, fed specs the fixture cannot produce: restatements are dropped,
// a new effort or model is a row.
test('a spec that changes is logged again, effort included', async () => {
  const specs = [
    { model: 'claude-fable-5' },
    { model: 'claude-fable-5' },
    { model: 'claude-fable-5', effort: 'high' },
    { model: 'claude-fable-5', effort: 'high' },
    // No effort is unknown, not none: the effort on record stands.
    { model: 'claude-fable-5' },
    { model: 'claude-fable-5', effort: 'low' },
    { model: 'claude-opus-5' },
    { model: 'claude-opus-5', effort: 'low' },
  ];
  const adapter = scripted(specs.map((spec): Mapped => ({ events: [], spec })));
  const { supervisor, log, emitted } = await setup({}, adapter);
  await supervisor.send('go');
  await untilState(emitted, 'idle');
  expect(specsOf(log)).toEqual([
    { model: 'claude-fable-5' },
    { model: 'claude-fable-5', effort: 'high' },
    { model: 'claude-fable-5', effort: 'low' },
    { model: 'claude-opus-5' },
    { model: 'claude-opus-5', effort: 'low' },
  ]);
  await supervisor.close();
});

// An effort the operator set in-band (ADR 0031): the record keeps it, so every later spawn of
// this session asks for it, a fresh supervisor's included, and the chip sees it as a spec row.
test('an effort the agent confirms is kept on the record and asked for at every spawn', async () => {
  const told: Mapped = {
    events: [],
    chosen: { effort: 'medium' },
    spec: { model: 'claude-fable-5', effort: 'medium' },
    turnEnded: true,
  };
  const box = await setup({}, scripted([told]));
  const { supervisor, log, sessions, spawns, emitted } = box;
  await supervisor.send('/effort medium');
  await untilEvent(emitted, 'session.state', 2);
  expect(spawns[0]?.effort).toBeUndefined();
  expect(sessions.get('s1').effort).toBe('medium');
  expect(specsOf(log)).toEqual([{ model: 'claude-fable-5', effort: 'medium' }]);
  await supervisor.close();
  await supervisor.send('again');
  expect(spawns[1]?.effort).toBe('medium');
  await supervisor.close();
  const reopened = box.reopen();
  await reopened.send('and again');
  expect(spawns[2]?.effort).toBe('medium');
  await reopened.close();
});

// A level the flag refuses (ADR 0031 § 3) reaches the chip and leaves the record alone.
test('a level the agent runs but the flag refuses is a spec row, not a record change', async () => {
  const shown: Mapped = {
    events: [],
    spec: { model: 'claude-fable-5', effort: 'ultracode' },
    turnEnded: true,
  };
  const { supervisor, log, sessions, spawns, emitted } = await setup({}, scripted([shown]));
  await supervisor.send('/effort ultracode');
  await untilEvent(emitted, 'session.state', 2);
  expect(specsOf(log)).toEqual([{ model: 'claude-fable-5', effort: 'ultracode' }]);
  expect('effort' in sessions.get('s1')).toBe(false);
  await supervisor.close();
  await supervisor.send('again');
  expect(spawns[1]?.effort).toBeUndefined();
  await supervisor.close();
});
