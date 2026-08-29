import type { Bytes, Channel, Wire } from '@flux/protocol';
import { base64url, bytes, handshake, pairing, room } from '@flux/protocol';
import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

import { deviceHandshake } from '../test/device-side.ts';
import type { FakeRelay } from '../test/fake-relay.ts';
import { startFakeRelay } from '../test/fake-relay.ts';
import type { Daemon } from './create-daemon.ts';
import { createDaemon } from './create-daemon.ts';

// The whole daemon against a fake relay and the fake agent: pair, hello, create a session,
// send a message, watch events arrive, sync them back.

const fake = fileURLToPath(new URL('../test/fake-claude.ts', import.meta.url));
const fixture = fileURLToPath(
  new URL('../test/fixtures/claude/session-two-turns.jsonl', import.meta.url),
);
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

let relay: FakeRelay;
let daemon: Daemon;

afterEach(async () => {
  await daemon.stop();
  await relay.close();
});

const setup = async () => {
  process.env['FLUX_FAKE_FIXTURE'] = fixture;
  const root = await mkdtemp(join(tmpdir(), 'flux-daemon-'));
  const repos = join(root, 'repos');
  const repo = join(repos, 'app');
  await mkdir(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env: gitEnv });
  await writeFile(join(repo, 'README.md'), '# app\n');
  execFileSync('git', ['-c', 'user.email=t@x', '-c', 'user.name=t', 'add', '-A'], {
    cwd: repo,
    env: gitEnv,
  });
  execFileSync('git', ['-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: repo,
    env: gitEnv,
  });
  relay = await startFakeRelay();
  daemon = await createDaemon({
    dataDir: join(root, 'data'),
    relayUrl: relay.url,
    reposDir: repos,
    daemonName: 'flux@test',
    pushSubject: 'mailto:ops@example.com',
    claudeCommand: fake,
  });
  await daemon.start();
  await relay.host();
  return { repo, root };
};

// A device: parses the pairing URL, handshakes over the fake relay, returns an rpc caller.
const device = async () => {
  const url = daemon.pairingUrl();
  const payload = pairing.parse(new URL(url).hash);
  if (payload === null) throw new Error('bad pairing url');
  const keys = await handshake.generateKeyPair(true);
  const channel = await deviceHandshake({
    keys,
    boxPub: payload.boxPub,
    roomId: await room.id(payload.boxPub),
    send: relay.send,
    next: relay.nextFrame,
  });
  return { keys, payload, channel };
};

const open = async (channel: Channel, data: Bytes): Promise<Wire | null> => {
  const plain = await channel.open(data);
  return plain === null ? null : (JSON.parse(bytes.toUtf8(plain)) as Wire);
};

// Reads frames until one decrypts to a message the predicate accepts (recursion, not a loop:
// every frame is awaited in turn, which is the point).
const untilMatch = async (channel: Channel, match: (m: Wire) => boolean): Promise<Wire> => {
  const message = await open(channel, await relay.nextFrame());
  return message !== null && match(message) ? message : untilMatch(channel, match);
};

// Sends an rpc and returns its result, skipping any events broadcast in between.
const call = async (channel: Channel, method: string, params: unknown): Promise<unknown> => {
  const id = crypto.randomUUID();
  const rpc: Wire = { kind: 'rpc', id, method, params };
  relay.send(await channel.seal(bytes.fromUtf8(JSON.stringify(rpc))));
  const message = await untilMatch(channel, (m) => m.kind === 'rpc.result' && m.id === id);
  if (message.kind !== 'rpc.result') throw new Error('unreachable');
  if (message.ok) return message.result;
  throw new Error(`${message.error.code}: ${message.error.message}`);
};

const untilEvent = (channel: Channel, type: string): Promise<Wire> =>
  untilMatch(channel, (m) => m.kind === 'event' && m.event.type === type);

test('pair, create a session, talk to the agent, sync the log', async () => {
  const { repo } = await setup();
  const d = await device();
  await expect(call(d.channel, 'sessions.list', {})).rejects.toThrow('not_paired');
  const proof = await pairing.proof(d.payload.secret, d.keys.publicKey, d.payload.boxPub);
  const paired = await call(d.channel, 'pair.request', {
    devPub: base64url.encode(d.keys.publicKey),
    proof: base64url.encode(proof),
  });
  expect(paired).toMatchObject({ deviceId: expect.any(String) });
  expect(daemon.devices()).toHaveLength(1);
  expect(await call(d.channel, 'hello', { protocol: 1 })).toEqual({
    protocol: 1,
    daemon: 'flux@test',
    sessions: [],
    vapidPublicKey: expect.stringMatching(/^B[\w-]{86}$/u),
  });
  expect(await call(d.channel, 'repos.list', {})).toEqual({
    repos: [{ path: repo, name: 'app', branches: ['main'] }],
  });
  const created = await call(d.channel, 'sessions.create', {
    repo,
    branch: 'flux/task',
    agent: 'claude',
    title: 'Task',
  });
  expect(created).toMatchObject({ title: 'Task', branch: 'flux/task', state: 'idle' });
  const { session } = created as { session: string };
  const sent = await call(d.channel, 'agent.send', { session, text: 'go' });
  expect(sent).toEqual({ seq: 2 });
  await untilEvent(d.channel, 'turn.ended');
  const synced = (await call(d.channel, 'events.sync', { session, since: 0 })) as {
    events: { seq: number; type: string }[];
    complete: boolean;
  };
  expect(synced.complete).toBe(true);
  expect(synced.events.map((e) => e.seq)).toEqual(synced.events.map((_, i) => i + 1));
  expect(synced.events.map((e) => e.type)).toContain('tool.start');
  const status = (await call(d.channel, 'git.status', { session })) as { files: unknown[] };
  expect(status.files).toEqual([]);
  expect(await call(d.channel, 'fs.list', { session, path: '.' })).toEqual({
    entries: [{ name: 'README.md', kind: 'file' }],
  });
  await expect(call(d.channel, 'fs.read', { session, path: '../x' })).rejects.toThrow('bad_params');
  expect(await call(d.channel, 'sessions.cost', { session })).toMatchObject({ turns: 1 });
  await call(d.channel, 'sessions.archive', { session });
  expect(await call(d.channel, 'sessions.list', {})).toEqual([]);
});

// A paired device with one session whose worktree is on disk.
const pairedSession = async () => {
  const { repo, root } = await setup();
  const d = await device();
  const proof = await pairing.proof(d.payload.secret, d.keys.publicKey, d.payload.boxPub);
  await call(d.channel, 'pair.request', {
    devPub: base64url.encode(d.keys.publicKey),
    proof: base64url.encode(proof),
  });
  const created = (await call(d.channel, 'sessions.create', {
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
  const read = (await call(d.channel, 'fs.read', { session, path: 'README.md' })) as {
    content: string;
    hash: string;
    truncated: boolean;
  };
  expect(read).toMatchObject({ content: '# app\n', truncated: false });
  const saved = (await call(d.channel, 'fs.write', {
    session,
    path: 'README.md',
    content: '# app\n\nedited\n',
    ifMatch: read.hash,
  })) as { hash: string };
  expect(await readFile(join(worktree, 'README.md'), 'utf8')).toBe('# app\n\nedited\n');
  await expect(
    call(d.channel, 'fs.write', { session, path: 'README.md', content: 'x', ifMatch: read.hash }),
  ).rejects.toThrow('conflict');
  expect(await readFile(join(worktree, 'README.md'), 'utf8')).toBe('# app\n\nedited\n');
  const again = (await call(d.channel, 'fs.read', { session, path: 'README.md' })) as {
    hash: string;
  };
  expect(again.hash).toBe(saved.hash);
  const status = (await call(d.channel, 'git.status', { session })) as { files: unknown[] };
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
      expect(call(d.channel, 'fs.write', { session, path, content: 'x' })).rejects.toThrow(
        'bad_params',
      ),
    ),
  );
  await Promise.all(
    escapes.map((path) =>
      expect(call(d.channel, 'fs.read', { session, path })).rejects.toThrow('bad_params'),
    ),
  );
  await expect(call(d.channel, 'fs.list', { session, path: '.git' })).rejects.toThrow('bad_params');
  expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# app\n');
  // A symlink that stays inside is written through: the link survives, the target changes.
  await symlink(join(worktree, 'README.md'), join(worktree, 'alias.md'));
  await call(d.channel, 'fs.write', { session, path: 'alias.md', content: 'via link\n' });
  expect((await lstat(join(worktree, 'alias.md'))).isSymbolicLink()).toBe(true);
  expect(await readFile(join(worktree, 'README.md'), 'utf8')).toBe('via link\n');
});
