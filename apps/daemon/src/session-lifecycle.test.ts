import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { gitIn } from '../test/git-in.ts';
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
      harness: 'claude',
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
    harness: 'claude',
  });
  await expect(
    sessionLifecycle.archive(ctx, { session: 's1', removeWorktree: true, discard: true }),
  ).rejects.toMatchObject({ code: 'bad_params' });
  expect(closed).toEqual(['s1']);
  expect(sessions.get('s1').archived).toBe(false);
  expect(await git.branches(repo)).toEqual(['main']);
});

// A commit adding a file named after its subject, so no two share a patch.
const commitIn = async (cwd: string, subject: string): Promise<string> => {
  await writeFile(join(cwd, `${subject}.txt`), `${subject}\n`);
  gitIn(cwd, ['add', '-A']);
  gitIn(cwd, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-q',
    '-m',
    subject,
  ]);
  return gitIn(cwd, ['rev-parse', '--short=7', 'HEAD']).trim();
};

// The refusal says what is at risk and lists the commits, so the operator can judge them. A
// branch kept by the delete holds its commits, so only a deleted one's are named.
test('removing a worktree with work only on this machine is refused, naming it', async () => {
  const { worktreesDir, ctx, sessions, create } = await setup();
  const worktree = join(worktreesDir, 's2');
  await create('s2', worktree);
  const sha = await commitIn(worktree, 'keep me');
  gitIn(worktree, ['switch', '-q', '--detach']);
  await writeFile(join(worktree, 'c.txt'), 'c\n');
  await expect(
    sessionLifecycle.archive(ctx, { session: 's2', removeWorktree: true }),
  ).rejects.toMatchObject({ code: 'dirty', message: 'The worktree has 1 uncommitted file.' });
  await expect(
    sessionLifecycle.archive(ctx, { session: 's2', removeWorktree: true, deleteBranch: true }),
  ).rejects.toMatchObject({
    code: 'dirty',
    message: [
      'The worktree has 1 uncommitted file.',
      '1 commit exists only on this machine:',
      `${sha} keep me`,
      'HEAD is detached.',
    ].join('\n'),
  });
  expect(sessions.get('s2').archived).toBe(false);
});

test('the refusal names ten commits, counts the rest, and says which are possibly merged', async () => {
  const { root, repo, worktreesDir, ctx, create } = await setup();
  const origin = join(root, 'origin.git');
  gitIn(root, ['init', '-q', '--bare', origin]);
  gitIn(repo, ['remote', 'add', 'origin', origin]);
  gitIn(repo, ['push', '-q', 'origin', 'main']);
  gitIn(repo, ['remote', 'set-head', 'origin', 'main']);
  const worktree = join(worktreesDir, 's2');
  await create('s2', worktree);
  const merged = await commitIn(worktree, 'merged');
  // One after another: each commit's parent is the one before.
  const shas = await Array.from({ length: 11 }, (_, i) => `c${i}`).reduce<Promise<string[]>>(
    async (done, subject) => [...(await done), await commitIn(worktree, subject)],
    Promise.resolve([]),
  );
  await commitIn(repo, 'main moved on');
  gitIn(repo, ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', 'cherry-pick', merged]);
  gitIn(repo, ['push', '-q', 'origin', 'main']);
  await expect(
    sessionLifecycle.archive(ctx, { session: 's2', removeWorktree: true, deleteBranch: true }),
  ).rejects.toMatchObject({
    code: 'dirty',
    message: [
      '12 commits exist only on this machine, 1 possibly merged:',
      ...shas
        .toReversed()
        .slice(0, 10)
        .map((sha, i) => `${sha} c${10 - i}`),
      'and 2 more, 1 possibly merged',
    ].join('\n'),
  });
});

// The branch on the summary follows HEAD (`session.head`), but the one archive deletes is
// the session's own, the one it was created on: deleting whatever the agent last checked out
// would take a branch that is not the session's, or fail on a detached HEAD's sha.
test('deleting the branch on archive deletes the created one, wherever HEAD went', async () => {
  const { repo, worktreesDir, ctx, git, sessions, create } = await setup();
  const worktree = join(worktreesDir, 's2');
  await create('s2', worktree);
  gitIn(worktree, ['switch', '-q', '-c', 'feat/other']);
  sessions.setHead('s2', 'feat/other');
  await sessionLifecycle.archive(ctx, { session: 's2', removeWorktree: true, deleteBranch: true });
  expect(await git.branches(repo)).toEqual(['feat/other', 'main']);
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
  const cleared = await sessionLifecycle.clear(ctx, 's3');
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
  expect(cleared).toEqual({ seq: log.lastSeq('s3') });
});

// The message that is the clear (ADR 0034): `/clear` alone, whitespace around it forgiven, and
// nothing else, so a message that starts with the word still reaches the agent.
test('a bare /clear is the clear command; anything more is a message', () => {
  const clears = ['/clear', ' /clear ', '/clear\n'].map((t) => sessionLifecycle.isClearCommand(t));
  expect(clears).toEqual([true, true, true]);
  const messages = ['/clear this up', '/cleared', 'clear', '/Clear', '/compact'].map((t) =>
    sessionLifecycle.isClearCommand(t),
  );
  expect(messages).toEqual([false, false, false, false, false]);
});

test('restart closes the agent then sets the model and effort, clears one on null, keeps on absent', async () => {
  const { worktreesDir, ctx, sessions, closed, create } = await setup();
  await create('s5', join(worktreesDir, 's5'));
  sessions.setModel('s5', 'opus');
  sessions.setEffort('s5', 'high');
  await sessionLifecycle.restart(ctx, { session: 's5' });
  expect(closed).toEqual(['s5']);
  expect(sessions.get('s5')).toMatchObject({ model: 'opus', effort: 'high' });
  await sessionLifecycle.restart(ctx, { session: 's5', model: ' sonnet ', effort: null });
  expect(closed).toEqual(['s5', 's5']);
  expect(sessions.get('s5')).toMatchObject({ model: 'sonnet' });
  expect(sessions.get('s5')).not.toHaveProperty('effort');
  await expect(
    sessionLifecycle.restart(ctx, { session: 's5', effort: '  ' }),
  ).rejects.toMatchObject({ code: 'bad_params' });
  expect(sessions.get('s5')).toMatchObject({ model: 'sonnet' });
  await expect(sessionLifecycle.restart(ctx, { session: 'nope' })).rejects.toMatchObject({
    code: 'not_found',
  });
  expect(closed).toHaveLength(2);
});

// A send not queued behind the restart (a manager's, over the control socket) must already
// see the new spec, so the row is written before the agent closes as well as after.
test('restart writes the spec before the close too', async () => {
  const { worktreesDir, ctx, sessions, create } = await setup();
  await create('s6', join(worktreesDir, 's6'));
  const seen: (string | undefined)[] = [];
  const closing = {
    ...ctx,
    closeSupervisor: (session: string) => {
      seen.push(sessions.get(session).model);
      return Promise.resolve();
    },
  };
  await sessionLifecycle.restart(closing, { session: 's6', model: 'opus' });
  expect(seen).toEqual(['opus']);
});

// A Claude draining a `/effort` during the close confirms it after the first write (ADR 0031),
// so the row is written again after the close and the restart's word stands.
test('restart writes the spec after the close too, over an effort the closing agent confirmed', async () => {
  const { worktreesDir, ctx, sessions, create } = await setup();
  await create('s7', join(worktreesDir, 's7'));
  const confirming = {
    ...ctx,
    closeSupervisor: (session: string) => {
      sessions.setEffort(session, 'ultracode');
      return Promise.resolve();
    },
  };
  await sessionLifecycle.restart(confirming, { session: 's7', effort: 'medium' });
  expect(sessions.get('s7').effort).toBe('medium');
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
