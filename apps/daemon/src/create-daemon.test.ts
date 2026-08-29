import type { Wire } from '@flux/protocol';
import { bytes } from '@flux/protocol';
import { chmod, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import type { Dev } from '../test/daemon-device.ts';
import { daemonDevice } from '../test/daemon-device.ts';
import type { FakeRelay } from '../test/fake-relay.ts';
import { startFakeRelay } from '../test/fake-relay.ts';
import type { FrameRouter } from '../test/frame-router.ts';
import { frameRouter } from '../test/frame-router.ts';
import { tempRepo } from '../test/temp-repo.ts';
import type { Daemon, DaemonConfig } from './create-daemon.ts';
import { createDaemon } from './create-daemon.ts';

// The whole daemon against a fake relay and the fake agent: pair, hello, create a session,
// send a message, watch events arrive, sync them back; then a second device, settings, and
// revocation in both directions.

const fake = join(import.meta.dirname, '../test/fake-claude.ts');
const fixture = join(import.meta.dirname, '../test/fixtures/claude/session-two-turns.jsonl');
let relay: FakeRelay;
let frames: FrameRouter;
let daemon: Daemon;

afterEach(async () => {
  await daemon.stop();
  await relay.close();
});

const setup = async (extra: Partial<DaemonConfig> = {}) => {
  process.env['FLUX_FAKE_FIXTURE'] = fixture;
  const { root, repos, repo } = await tempRepo();
  relay = await startFakeRelay();
  frames = frameRouter(relay.nextFrame);
  const claudeDir = join(root, 'claude');
  daemon = await createDaemon({
    dataDir: join(root, 'data'),
    relayUrl: relay.url,
    reposDir: repos,
    daemonName: 'flux@test',
    pushSubject: 'mailto:ops@example.com',
    claudeCommand: fake,
    // The dev box may have pi on PATH; a test says when it wants one (any executable will do).
    piCommand: 'no-such-binary-anywhere',
    claudeDir,
    ...extra,
  });
  await daemon.start();
  await relay.host();
  return { repo, root, repos, claudeDir };
};

const { device, call, untilEvent, untilRevoked, controlRm, pair, collect } = daemonDevice({
  daemon: () => daemon,
  relay: () => relay,
  frames: () => frames,
});

// A reply names a message by seq: an unknown one, or one from another session's log, is
// refused; a known one is logged as `replyTo`.
const replyRoundTrip = async (d: Dev, session: string, repo: string): Promise<void> => {
  await expect(call(d, 'agent.send', { session, text: 'and', replyTo: 99 })).rejects.toThrow(
    'bad_params',
  );
  const other = (await call(d, 'sessions.create', {
    repo,
    branch: 'flux/other',
    agent: 'claude',
  })) as {
    session: string;
  };
  await expect(
    call(d, 'agent.send', { session: other.session, text: 'and', replyTo: 2 }),
  ).rejects.toThrow('bad_params');
  await call(d, 'sessions.archive', { session: other.session });
  const replied = (await call(d, 'agent.send', { session, text: 'and', replyTo: 2 })) as {
    seq: number;
  };
  await untilEvent(d, 'turn.ended');
  const { events } = (await call(d, 'events.sync', { session, since: 0 })) as {
    events: { seq: number; payload: unknown }[];
  };
  expect(events.find((e) => e.seq === replied.seq)?.payload).toEqual({ text: 'and', replyTo: 2 });
};

test('pair, create a session, talk to the agent, sync the log', async () => {
  const { repo } = await setup();
  const d = await device();
  await expect(call(d, 'sessions.list', {})).rejects.toThrow('not_paired');
  const deviceId = await pair(d);
  expect(deviceId).toEqual(expect.any(String));
  expect(daemon.devices()).toHaveLength(1);
  expect(await call(d, 'hello', { protocol: 2 })).toEqual({
    protocol: 2,
    daemon: 'flux@test',
    sessions: [],
    vapidPublicKey: expect.stringMatching(/^B[\w-]{86}$/u),
    agents: ['claude'],
  });
  expect(await call(d, 'repos.list', {})).toEqual({
    repos: [{ path: repo, name: 'app', branches: ['main'] }],
  });
  const created = await call(d, 'sessions.create', {
    repo,
    branch: 'flux/task',
    agent: 'claude',
    title: 'Task',
  });
  expect(created).toMatchObject({ title: 'Task', branch: 'flux/task', state: 'idle' });
  const { session } = created as { session: string };
  const sent = await call(d, 'agent.send', { session, text: 'go' });
  expect(sent).toEqual({ seq: 2 });
  await untilEvent(d, 'turn.ended');
  const synced = (await call(d, 'events.sync', { session, since: 0 })) as {
    events: { seq: number; type: string }[];
    complete: boolean;
  };
  expect(synced.complete).toBe(true);
  expect(synced.events.map((e) => e.seq)).toEqual(synced.events.map((_, i) => i + 1));
  expect(synced.events.map((e) => e.type)).toContain('tool.start');
  await replyRoundTrip(d, session, repo);
  const status = (await call(d, 'git.status', { session })) as { files: unknown[] };
  expect(status.files).toEqual([]);
  expect(await call(d, 'fs.list', { session, path: '.' })).toEqual({
    entries: [{ name: 'README.md', kind: 'file' }],
  });
  await expect(call(d, 'fs.read', { session, path: '../x' })).rejects.toThrow('bad_params');
  expect(await call(d, 'sessions.cost', { session })).toMatchObject({ turns: 2 });
  await call(d, 'sessions.archive', { session });
  expect(await call(d, 'sessions.list', {})).toContainEqual(
    expect.objectContaining({ session, archived: true, worktreeExists: true }),
  );
});

const lastTypes = async (d: Awaited<ReturnType<typeof device>>, session: string, n: number) => {
  const synced = (await call(d, 'events.sync', { session, since: 0 })) as {
    events: { type: string }[];
  };
  return synced.events.slice(-n).map((e) => e.type);
};

// Clearing keeps the worktree and the log and marks where the fresh context starts; archiving
// hides the session and can take the worktree and the branch with it, but never work that is
// nowhere else unless told to discard it; a session whose worktree is gone cannot come back.
test('clear, archive, reopen and delete a session', async () => {
  const { repo, root } = await setup();
  const d = await device();
  await pair(d);
  await call(d, 'hello', { protocol: 1 });
  const created = (await call(d, 'sessions.create', {
    repo,
    branch: 'flux/gone',
    agent: 'claude',
  })) as { session: string };
  const { session } = created;
  const worktree = join(root, 'data', 'worktrees', session);
  await call(d, 'agent.send', { session, text: 'go' });
  await untilEvent(d, 'turn.ended');
  await call(d, 'sessions.clear', { session });
  expect(await lastTypes(d, session, 1)).toEqual(['session.cleared']);
  expect(await call(d, 'sessions.list', {})).toEqual([
    expect.objectContaining({ session, archived: false, worktreeExists: true }),
  ]);
  await call(d, 'sessions.archive', { session });
  expect(await call(d, 'sessions.list', {})).toEqual([expect.objectContaining({ archived: true })]);
  await call(d, 'sessions.unarchive', { session });
  expect(await call(d, 'sessions.list', {})).toEqual([
    expect.objectContaining({ archived: false }),
  ]);
  await writeFile(join(worktree, 'wip.txt'), 'not committed\n');
  await expect(call(d, 'sessions.archive', { session, removeWorktree: true })).rejects.toThrow(
    'dirty: worktree has 1 uncommitted file',
  );
  expect(await call(d, 'sessions.list', {})).toEqual([
    expect.objectContaining({ archived: false }),
  ]);
  await call(d, 'sessions.archive', {
    session,
    removeWorktree: true,
    deleteBranch: true,
    discard: true,
  });
  expect(await call(d, 'sessions.list', {})).toEqual([
    expect.objectContaining({ session, archived: true, worktreeExists: false }),
  ]);
  expect(await call(d, 'repos.list', {})).toEqual({
    repos: [{ path: repo, name: 'app', branches: ['main'] }],
  });
  await expect(call(d, 'sessions.unarchive', { session })).rejects.toThrow('not_found');
});

// Two devices paired in turn, the second while the first is connected, both past hello.
const twoDevices = async () => {
  const { repo } = await setup();
  const a = await device();
  const aId = await pair(a);
  await call(a, 'hello', { protocol: 1 });
  const b = await device();
  const bId = await pair(b);
  await call(b, 'hello', { protocol: 1 });
  return { repo, a, aId, b, bId };
};

const listed = (deviceId: string, current: boolean) => ({
  deviceId,
  name: 'device',
  pairedAt: expect.any(String),
  lastSeenAt: expect.any(String),
  current,
});

test('a second device pairs while the first is connected and both receive events', async () => {
  const { repo, a, aId, b, bId } = await twoDevices();
  expect(await call(a, 'devices.list', {})).toEqual([listed(aId, true), listed(bId, false)]);
  expect(await call(b, 'devices.list', {})).toEqual([listed(aId, false), listed(bId, true)]);
  const created = (await call(a, 'sessions.create', {
    repo,
    branch: 'flux/one',
    agent: 'claude',
  })) as { session: string };
  await call(a, 'agent.send', { session: created.session, text: 'go' });
  await untilEvent(a, 'turn.ended');
  await untilEvent(b, 'turn.ended');
});

test('revoking a device cuts it off at once and leaves the other one working', async () => {
  const { a, aId, b, bId } = await twoDevices();
  // A revokes B: B is told, its frames are ignored from then on, and A carries on.
  expect(await call(a, 'devices.remove', { deviceId: bId })).toEqual({});
  expect(await untilRevoked(b)).toEqual({
    kind: 'ephemeral',
    data: { type: 'device.revoked', deviceId: bId },
  });
  expect(daemon.devices().map((d) => d.deviceId)).toEqual([aId]);
  relay.send(await b.channel.seal(bytes.fromUtf8('{"kind":"rpc","id":"x","method":"hello"}')));
  // The box answers frames in order, so A's answer arriving proves B's frame was dropped.
  await call(a, 'sessions.list', {});
  expect(frames.pending(b.fingerprint)).toBe(0);
  await expect(call(a, 'devices.remove', { deviceId: bId })).rejects.toThrow('not_found');
  // B comes back with the same keys: the pairing window is still open, so it is answered as a
  // stranger, and a stranger may only pair.
  const again = await device(b.keys);
  await expect(call(again, 'hello', { protocol: 1 })).rejects.toThrow('not_paired');
  expect(await call(a, 'devices.list', {})).toHaveLength(1);
  // A removes itself: the answer arrives, then the notice, and the trust list is empty.
  expect(await call(a, 'devices.remove', { deviceId: aId })).toEqual({});
  await untilRevoked(a);
  expect(daemon.devices()).toEqual([]);
});

test('flux devices rm over the control socket cuts a connected device off', async () => {
  const { a, aId, b, bId } = await twoDevices();
  expect(await controlRm(bId)).toEqual({ ok: true, result: {} });
  expect(await untilRevoked(b)).toEqual({
    kind: 'ephemeral',
    data: { type: 'device.revoked', deviceId: bId },
  });
  expect(daemon.devices().map((d) => d.deviceId)).toEqual([aId]);
  expect(await call(a, 'devices.list', {})).toHaveLength(1);
  expect(await controlRm(bId)).toMatchObject({ ok: false });
});

test('settings: runtime values persist, env is read-only, agent config files are edited', async () => {
  const { repos, claudeDir } = await setup({ piCommand: fake });
  const d = await device();
  await pair(d);
  const initial = (await call(d, 'settings.get', {})) as {
    flux: unknown;
    env: unknown;
    agent: unknown;
  };
  expect(initial).toEqual({
    flux: {
      reposDir: repos,
      defaultAgent: 'claude',
      notifyOnAsk: true,
      notifyOnIdle: true,
      notifyOnDone: true,
    },
    env: {
      relayUrl: relay.url,
      dataDir: expect.stringContaining('data'),
      daemonName: 'flux@test',
      pushSubject: 'mailto:ops@example.com',
      claudeCommand: fake,
    },
    agent: { claudeMd: '', settingsJson: '' },
  });
  const updated = await call(d, 'settings.set', {
    flux: { notifyOnIdle: false, defaultAgent: 'pi' },
    agent: { claudeMd: '# Be terse\n', settingsJson: '{"model":"opus"}' },
  });
  expect(updated).toMatchObject({
    flux: { notifyOnIdle: false, defaultAgent: 'pi', reposDir: repos },
    agent: { claudeMd: '# Be terse\n', settingsJson: '{"model":"opus"}' },
  });
  expect(await readFile(join(claudeDir, 'CLAUDE.md'), 'utf8')).toBe('# Be terse\n');
  expect(await call(d, 'settings.get', {})).toEqual(updated);
});

test('settings.set refuses a bad patch whole, and a repos dir change applies at once', async () => {
  const { repos, claudeDir } = await setup();
  const d = await device();
  await pair(d);
  const updated = await call(d, 'settings.set', { agent: { claudeMd: 'kept' } });
  await expect(
    call(d, 'settings.set', { flux: { reposDir: repos }, agent: { settingsJson: '{' } }),
  ).rejects.toThrow('bad_params');
  await expect(
    call(d, 'settings.set', { flux: { reposDir: '/nowhere' }, agent: { claudeMd: 'lost' } }),
  ).rejects.toThrow('not a directory');
  await expect(call(d, 'settings.set', { flux: { reposDir: 'relative' } })).rejects.toThrow(
    'bad_params',
  );
  expect(await call(d, 'settings.get', {})).toEqual(updated);
  expect(await readFile(join(claudeDir, 'CLAUDE.md'), 'utf8')).toBe('kept');
  // A repos dir change applies to the next call without a restart, and a trailing slash is
  // normalised away so `inside` still matches.
  const empty = join(repos, '..', 'empty');
  await mkdir(empty);
  const moved = (await call(d, 'settings.set', { flux: { reposDir: `${empty}/` } })) as {
    flux: { reposDir: string };
  };
  expect(moved.flux.reposDir).toBe(empty);
  expect(await call(d, 'repos.list', {})).toEqual({ repos: [] });
});

// A paired device with one session whose worktree is on disk.
const pairedSession = async () => {
  const { repo, root } = await setup();
  const d = await device();
  await pair(d);
  const created = (await call(d, 'sessions.create', {
    repo,
    branch: 'flux/edit',
    agent: 'claude',
  })) as { session: string };
  const { session } = created;
  const worktree = join(root, 'data', 'worktrees', session);
  return { repo, d, session, worktree };
};

// Two devices edit one file: the second save carries a stale hash and is refused without
// touching the file.
test('a paired device edits a file in the worktree, with conflict detection', async () => {
  const { d, session, worktree } = await pairedSession();
  const read = (await call(d, 'fs.read', { session, path: 'README.md' })) as {
    content: string;
    hash: string;
    truncated: boolean;
  };
  expect(read).toMatchObject({ content: '# app\n', truncated: false });
  const saved = (await call(d, 'fs.write', {
    session,
    path: 'README.md',
    content: '# app\n\nedited\n',
    ifMatch: read.hash,
  })) as { hash: string };
  expect(await readFile(join(worktree, 'README.md'), 'utf8')).toBe('# app\n\nedited\n');
  await expect(
    call(d, 'fs.write', { session, path: 'README.md', content: 'x', ifMatch: read.hash }),
  ).rejects.toThrow('conflict');
  expect(await readFile(join(worktree, 'README.md'), 'utf8')).toBe('# app\n\nedited\n');
  const again = (await call(d, 'fs.read', { session, path: 'README.md' })) as {
    hash: string;
  };
  expect(again.hash).toBe(saved.hash);
  const status = (await call(d, 'git.status', { session })) as { files: unknown[] };
  expect(status.files).toEqual([{ path: 'README.md', status: 'M' }]);
});

// Paths that lexically or through a symlink leave the worktree, or enter .git, are refused for
// reads, writes and listings alike; a symlink that stays inside is written through.
test('file access stays inside the worktree and out of .git', async () => {
  const { repo, d, session, worktree } = await pairedSession();
  await symlink(join(repo, 'README.md'), join(worktree, 'link.md'));
  const escapes = ['../escape.md', '/etc/passwd', 'link.md', '.git/config', '.git'];
  await Promise.all(
    escapes.map((path) =>
      expect(call(d, 'fs.write', { session, path, content: 'x' })).rejects.toThrow('bad_params'),
    ),
  );
  await Promise.all(
    escapes.map((path) =>
      expect(call(d, 'fs.read', { session, path })).rejects.toThrow('bad_params'),
    ),
  );
  await Promise.all(
    escapes.map((path) =>
      expect(call(d, 'git.show', { session, path, rev: 'worktree' })).rejects.toThrow('bad_params'),
    ),
  );
  expect(await call(d, 'git.show', { session, path: 'README.md', rev: 'worktree' })).toMatchObject({
    content: '# app\n',
    binary: false,
  });
  await expect(call(d, 'fs.list', { session, path: '.git' })).rejects.toThrow('bad_params');
  expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# app\n');
  // A symlink that stays inside is written through: the link survives, the target changes.
  await symlink(join(worktree, 'README.md'), join(worktree, 'alias.md'));
  await call(d, 'fs.write', { session, path: 'alias.md', content: 'via link\n' });
  expect((await lstat(join(worktree, 'alias.md'))).isSymbolicLink()).toBe(true);
  expect(await readFile(join(worktree, 'README.md'), 'utf8')).toBe('via link\n');
});

// What a handler appends reaches every device as an event, and the caller sees the event before
// its own result: the two are sealed on the caller's channel in that order, so the result may
// not overtake it (a device refuses a frame numbered below one it has already accepted).
test('a comment added by one device is an event on both, before the result', async () => {
  const { repo } = await setup();
  const first = await device();
  await pair(first);
  const second = await device();
  await pair(second);
  expect(daemon.devices()).toHaveLength(2);
  const created = await call(first, 'sessions.create', {
    repo,
    branch: 'flux/two',
    agent: 'claude',
  });
  const { session } = created as { session: string };
  // The second device has the session.created broadcast queued; read past it first.
  await untilEvent(second, 'session.created');
  const ref = { path: 'README.md', rev: 'worktree', range: { startLine: 1, endLine: 1 } };
  const rpc: Wire = {
    kind: 'rpc',
    id: 'c1',
    method: 'comments.add',
    params: { session, ref, text: 'why' },
  };
  relay.send(await second.channel.seal(bytes.fromUtf8(JSON.stringify(rpc))));
  const [onFirst, onSecond] = await collect([first, second], [1, 2]);
  const event = { kind: 'event', event: expect.objectContaining({ type: 'comment.added' }) };
  expect(onFirst).toEqual([event]);
  expect(onSecond).toEqual([
    event,
    { kind: 'rpc.result', id: 'c1', ok: true, result: { commentId: expect.any(String) } },
  ]);
});

const fakeGh = `#!/bin/sh
case "$2" in
  view) echo "no pull requests found for branch" >&2; exit 1 ;;
  create) echo "https://github.com/o/r/pull/8" ;;
esac
`;

// Opening a PR from the phone logs `pr.published`, the event the adapter logs when the agent
// opens one itself (ADR 0014, amended), and the caller sees that event before its result. `gh`
// is a script first on PATH, which the daemon reads when it is created (no PR yet, then one).
test('git.pr logs pr.published, seen by the caller before the result', async () => {
  const bin = join((await tempRepo()).root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'gh'), fakeGh);
  await chmod(join(bin, 'gh'), 0o755);
  const path = String(process.env['PATH']);
  process.env['PATH'] = `${bin}:${path}`;
  const { repo } = await setup();
  process.env['PATH'] = path;
  const d = await device();
  await pair(d);
  const created = await call(d, 'sessions.create', { repo, branch: 'flux/pr', agent: 'claude' });
  const { session } = created as { session: string };
  const rpc: Wire = { kind: 'rpc', id: 'p1', method: 'git.pr', params: { session, title: 'Ship' } };
  relay.send(await d.channel.seal(bytes.fromUtf8(JSON.stringify(rpc))));
  const [seen] = await collect([d], [2]);
  const url = 'https://github.com/o/r/pull/8';
  expect(seen).toEqual([
    {
      kind: 'event',
      event: expect.objectContaining({
        type: 'pr.published',
        payload: { provider: 'github', url, repo: 'o/r', identifier: '8', action: 'created' },
      }),
    },
    { kind: 'rpc.result', id: 'p1', ok: true, result: { url } },
  ]);
  const synced = (await call(d, 'events.sync', { session, since: 0 })) as {
    events: { type: string }[];
  };
  expect(synced.events.map((e) => e.type)).toEqual(['session.created', 'pr.published']);
});

test('refuses to create a session for an agent the box does not have', async () => {
  const { repo } = await setup();
  const d = await device();
  await pair(d);
  await expect(
    call(d, 'sessions.create', { repo, branch: 'flux/pi', agent: 'pi' }),
  ).rejects.toThrow('agent_unavailable');
  await expect(call(d, 'settings.set', { flux: { defaultAgent: 'pi' } })).rejects.toThrow(
    'agent_unavailable',
  );
  expect(await call(d, 'settings.set', { flux: { defaultAgent: 'claude' } })).toMatchObject({
    flux: { defaultAgent: 'claude' },
  });
});
