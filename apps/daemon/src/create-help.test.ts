import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { helpContext } from '../test/help-context.ts';
import { helpAgentSpec } from './help-agent-spec.ts';
import { sessionCreateOps } from './session-create-ops.ts';

const createHelp = sessionCreateOps.help;

// A daemon-managed Help session end to end (ADR 0008, `sessions.createHelp`): the real session
// machinery over the fixture-replaying fake agent, with no saved "Help" Agent, so the role/tools
// must be applied inline. Setup lives in `test/help-context.ts`.

// Resolves once an emitted event matches, the setImmediate idiom the supervisor tests use.
const until = (emitted: readonly { type: string }[], type: string): Promise<void> =>
  new Promise((resolve) => {
    const check = (): void => {
      if (emitted.some((e) => e.type === type)) resolve();
      else setImmediate(check);
    };
    check();
  });

let cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.map((done) => done()));
  cleanups = [];
});

const setup = async () => {
  const box = await helpContext();
  cleanups.push(box.cleanup);
  return box;
};

test('createHelp opens a read-only session on the managed help repo and delivers the question', async () => {
  const { ctx, dataDir, reposDir, sessions, log, emitted } = await setup();
  const question = 'How do I pair a new device?';
  const summary = await createHelp(ctx, { question });

  // A real session on the daemon's own help repo under the data dir, never a repo under reposDir.
  expect(summary.session).not.toBe('');
  expect(summary.repo).toBe(join(dataDir, 'help'));
  expect(summary.repo.startsWith(reposDir)).toBe(false);
  expect(summary.branch).toMatch(/^help-[0-9a-f]{8}$/u);
  expect(summary.title).toBe(question);

  // The role and tools are applied inline (no saved Help Agent exists here), so the session spawns
  // read-only with the help role — the spawn reads both straight off this persisted record.
  const record = sessions.get(summary.session);
  expect(record.role).toBe(helpAgentSpec.role);
  expect(record.tools).toEqual({ mode: 'deny', list: ['Bash', 'Edit', 'Write'] });

  // session.created names the help repo; the question is logged as the first msg.user.
  const events = log.read(summary.session, 0).events;
  const created = events.find((e) => e.type === 'session.created');
  expect(created?.payload).toMatchObject({ repo: join(dataDir, 'help'), branch: summary.branch });
  const userMsgs = events.filter((e) => e.type === 'msg.user');
  expect(userMsgs).toHaveLength(1);
  expect(userMsgs[0]?.payload).toMatchObject({ text: question });

  // Delivered to the agent: the fake replies, so an assistant message comes back.
  await until(emitted, 'msg.assistant');
});

test('the title is the first line of the question, trimmed to about 60 characters', async () => {
  const { ctx } = await setup();
  const first = 'x'.repeat(70);
  const summary = await createHelp(ctx, { question: `${first}\nsecond line` });
  expect(summary.title).toBe(`${'x'.repeat(60)}…`);
});

test('a blank question is bad_params and creates nothing', async () => {
  const { ctx, sessions } = await setup();
  await expect(createHelp(ctx, { question: '   ' })).rejects.toMatchObject({ code: 'bad_params' });
  expect(sessions.list()).toHaveLength(0);
});

test('the help repo is reused across help sessions', async () => {
  const { ctx, dataDir, sessions } = await setup();
  const a = await createHelp(ctx, { question: 'first' });
  const b = await createHelp(ctx, { question: 'second' });
  expect(a.repo).toBe(join(dataDir, 'help'));
  expect(b.repo).toBe(a.repo);
  expect(a.branch).not.toBe(b.branch);
  expect(sessions.list()).toHaveLength(2);
});
