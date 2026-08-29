import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { tempRepo } from '../test/temp-repo.ts';
import { createAskRegistry } from './create-ask-registry.ts';
import { createGitService } from './create-git-service.ts';
import { openDatabase } from './open-database.ts';
import { openStores } from './open-stores.ts';
import { sessionLifecycle } from './session-lifecycle.ts';

// The lifecycle against a real repository and a stand-in for the supervisor pool: what
// archiving refuses, what it tells git, how clearing orders the asks and the marker, and what
// renaming accepts.

const setup = async () => {
  const { root, repo } = await tempRepo();
  const worktreesDir = join(root, 'data', 'worktrees');
  await mkdir(worktreesDir, { recursive: true });
  const db = openDatabase(':memory:');
  const { log, sessions, attachments } = openStores(db, root, join(root, 'data', 'attachments'));
  const git = createGitService();
  const closed: string[] = [];
  const forgotten: string[] = [];
  const ctx = {
    sessions,
    git,
    log,
    asks: createAskRegistry(),
    attachments,
    worktreesDir,
    closeSupervisor: (session: string) => {
      closed.push(session);
      return Promise.resolve();
    },
    forgetAgentSession: (session: string) => {
      forgotten.push(session);
    },
  };
  const create = async (session: string, worktree: string): Promise<void> => {
    await git.addWorktree(repo, worktree, `flux/${session}`, 'main');
    const base = await git.revParse(repo, 'main');
    sessions.create({
      session,
      title: session,
      repo,
      worktree,
      branch: `flux/${session}`,
      base,
      agent: 'claude',
    });
  };
  return { root, repo, worktreesDir, ctx, git, sessions, log, closed, forgotten, create };
};

test("archiving keeps the session's attachments; deleting it takes the directory", async () => {
  const { ctx, create, root } = await setup();
  await create('s1', join(root, 'data', 'worktrees', 's1'));
  const id = await ctx.attachments.begin('s1', 'a.txt', 'text/plain', 0);
  // The sha256 of an empty file (secrets-allow: a well-known digest, not a key).
  await ctx.attachments.end(id, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); // secrets-allow
  const dir = join(root, 'data', 'attachments', 's1');
  expect(await readdir(dir)).toHaveLength(1);
  await sessionLifecycle.archive(ctx, { session: 's1' });
  expect(await readdir(dir)).toHaveLength(1);
  expect(ctx.attachments.get('s1', [id])).toHaveLength(1);
  await sessionLifecycle.unarchive(ctx, 's1');
  await sessionLifecycle.archive(ctx, { session: 's1', removeWorktree: true, discard: true });
  await expect(readdir(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(() => ctx.attachments.get('s1', [id])).toThrow(/no attachment/u);
});

test('only a worktree under the data directory is ever removed', async () => {
  const { repo, ctx, sessions, git, closed } = await setup();
  const base = await git.revParse(repo, 'main');
  // A row pointing at the repository itself, as a tampered database might.
  sessions.create({
    session: 's1',
    title: 's1',
    repo,
    worktree: repo,
    branch: 'main',
    base,
    agent: 'claude',
  });
  await expect(
    sessionLifecycle.archive(ctx, { session: 's1', removeWorktree: true, discard: true }),
  ).rejects.toMatchObject({ code: 'bad_params' });
  expect(closed).toEqual(['s1']);
  expect(sessions.get('s1').archived).toBe(false);
  expect(await git.branches(repo)).toEqual(['main']);
});

test('a worktree removed by hand is pruned so its branch can still be deleted', async () => {
  const { repo, worktreesDir, ctx, git, sessions, create } = await setup();
  const worktree = join(worktreesDir, 's2');
  await create('s2', worktree);
  await rm(worktree, { recursive: true, force: true });
  await sessionLifecycle.archive(ctx, { session: 's2', removeWorktree: true, deleteBranch: true });
  expect(await git.branches(repo)).toEqual(['main']);
  expect(sessions.get('s2').archived).toBe(true);
  await expect(sessionLifecycle.unarchive(ctx, 's2')).rejects.toMatchObject({ code: 'not_found' });
});

test('clear settles a pending ask through the registry, an orphan in the log, then marks', async () => {
  const { worktreesDir, ctx, sessions, log, closed, forgotten, create } = await setup();
  await create('s3', join(worktreesDir, 's3'));
  sessions.setAgentSessionId('s3', 'claude-abc');
  const ask = (askId: string): void => {
    log.append('s3', { type: 'ask', payload: { askId, question: 'go?', timeoutAt: 'never' } });
  };
  ask('orphan');
  ask('live');
  // The control handler's side of a live ask: it logs the answer once the registry settles it.
  const handled = ctx.asks
    .ask('live', 60_000)
    .then((answer) =>
      log.append('s3', { type: 'ask.answered', payload: { askId: 'live', ...answer } }),
    );
  await sessionLifecycle.clear(ctx, 's3');
  await handled;
  expect(closed).toEqual(['s3']);
  expect(forgotten).toEqual(['s3']);
  expect(sessions.get('s3').agentSessionId).toBeNull();
  expect(ctx.asks.pending()).toEqual([]);
  const tail = log.read('s3', 0).events.slice(-3);
  expect(tail.map((e) => [e.type, e.payload])).toEqual([
    ['ask.answered', { askId: 'orphan', answer: '', by: 'aborted' }],
    ['ask.answered', { askId: 'live', answer: '', by: 'aborted' }],
    ['session.cleared', {}],
  ]);
});

test('rename trims the title, stores it and logs it; a blank or oversized title is refused untouched', async () => {
  const { worktreesDir, ctx, sessions, log, create } = await setup();
  await create('s4', join(worktreesDir, 's4'));
  const titleLimit = 200;
  sessionLifecycle.rename(ctx, 's4', '  Fix login  ');
  expect(sessions.get('s4').title).toBe('Fix login');
  expect(sessions.list().find((s) => s.session === 's4')?.title).toBe('Fix login');
  const tail = log.read('s4', 0).events.at(-1);
  expect([tail?.type, tail?.payload]).toEqual(['session.renamed', { title: 'Fix login' }]);
  const seqAfterFirst = log.read('s4', 0).events.length;
  expect(() => sessionLifecycle.rename(ctx, 's4', '   ')).toThrow(
    expect.objectContaining({ code: 'bad_params' }),
  );
  expect(() => sessionLifecycle.rename(ctx, 's4', 'x'.repeat(10_000))).toThrow(
    expect.objectContaining({ code: 'bad_params' }),
  );
  sessionLifecycle.rename(ctx, 's4', ` ${'y'.repeat(titleLimit)} `);
  expect(sessions.get('s4').title).toBe('y'.repeat(titleLimit));
  expect(() => sessionLifecycle.rename(ctx, 's4', 'z'.repeat(titleLimit + 1))).toThrow(
    expect.objectContaining({ code: 'bad_params' }),
  );
  expect(sessions.get('s4').title).toBe('y'.repeat(titleLimit));
  expect(log.read('s4', 0).events.length).toBe(seqAfterFirst + 1);
  expect(() => sessionLifecycle.rename(ctx, 'nope', 'x')).toThrow(
    expect.objectContaining({ code: 'not_found' }),
  );
});
