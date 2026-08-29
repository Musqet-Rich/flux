import type { Bytes, Channel, Wire } from '@flux/protocol';
import { base64url, bytes, handshake, pairing, room } from '@flux/protocol';
import { lstat, mkdir, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { connect } from 'node:net';
import { afterEach, expect, test } from 'vitest';

import { deviceHandshake } from '../test/device-side.ts';
import type { FakeRelay } from '../test/fake-relay.ts';
import { startFakeRelay } from '../test/fake-relay.ts';
import type { FrameRouter } from '../test/frame-router.ts';
import { frameRouter } from '../test/frame-router.ts';
import { tempRepo } from '../test/temp-repo.ts';
import type { Daemon } from './create-daemon.ts';
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

const setup = async () => {
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
    claudeDir,
  });
  await daemon.start();
  await relay.host();
  return { repo, root, repos, claudeDir };
};

interface Dev {
  keys: Awaited<ReturnType<typeof handshake.generateKeyPair>>;
  payload: NonNullable<ReturnType<typeof pairing.parse>>;
  channel: Channel;
  next: () => Promise<Bytes>;
  fingerprint: Bytes;
}

// A device: parses a fresh pairing URL, handshakes over the fake relay, returns an rpc caller.
// `keys` lets a device come back with the identity it had.
const device = async (keys?: Dev['keys']): Promise<Dev> => {
  const url = daemon.pairingUrl();
  const payload = pairing.parse(new URL(url).hash);
  if (payload === null) throw new Error('bad pairing url');
  const own = keys ?? (await handshake.generateKeyPair(true));
  const fingerprint = await room.fingerprint(own.publicKey);
  const next = frames.register(fingerprint);
  const channel = await deviceHandshake({
    keys: own,
    boxPub: payload.boxPub,
    roomId: await room.id(payload.boxPub),
    send: relay.send,
    next,
  });
  return { keys: own, payload, channel, next, fingerprint };
};

const open = async (channel: Channel, data: Bytes): Promise<Wire | null> => {
  const plain = await channel.open(data);
  return plain === null ? null : (JSON.parse(bytes.toUtf8(plain)) as Wire);
};

// Reads frames until one decrypts to a message the predicate accepts (recursion, not a loop:
// every frame is awaited in turn, which is the point).
const untilMatch = async (d: Dev, match: (m: Wire) => boolean): Promise<Wire> => {
  const message = await open(d.channel, await d.next());
  return message !== null && match(message) ? message : untilMatch(d, match);
};

// Sends an rpc and returns its result, skipping any events broadcast in between.
const call = async (d: Dev, method: string, params: unknown): Promise<unknown> => {
  const id = crypto.randomUUID();
  const rpc: Wire = { kind: 'rpc', id, method, params };
  relay.send(await d.channel.seal(bytes.fromUtf8(JSON.stringify(rpc))));
  const message = await untilMatch(d, (m) => m.kind === 'rpc.result' && m.id === id);
  if (message.kind !== 'rpc.result') throw new Error('unreachable');
  if (message.ok) return message.result;
  throw new Error(`${message.error.code}: ${message.error.message}`);
};

const untilEvent = (d: Dev, type: string): Promise<Wire> =>
  untilMatch(d, (m) => m.kind === 'event' && m.event.type === type);

const untilRevoked = (d: Dev): Promise<Wire> =>
  untilMatch(d, (m) => m.kind === 'ephemeral' && m.data.type === 'device.revoked');

// What `flux devices rm` does: one line to the control socket, one line back.
const controlRm = (deviceId: string): Promise<unknown> =>
  new Promise((resolve) => {
    const client = connect(daemon.controlSocket, () => {
      client.write(`${JSON.stringify({ type: 'devices.rm', deviceId })}\n`);
    });
    client.once('data', (chunk: Buffer) => {
      client.end();
      resolve(JSON.parse(chunk.toString()));
    });
  });

const pair = async (d: Dev): Promise<string> => {
  const proof = await pairing.proof(d.payload.secret, d.keys.publicKey, d.payload.boxPub);
  const paired = (await call(d, 'pair.request', {
    devPub: base64url.encode(d.keys.publicKey),
    proof: base64url.encode(proof),
  })) as { deviceId: string };
  return paired.deviceId;
};

// Reads each device's frames until it has seen `wanted[i]` messages: what each device sees, in
// the order it sees it. A frame out of nonce order makes `open` throw, which fails the test.
const collect = (devs: Dev[], wanted: number[]): Promise<Wire[][]> =>
  Promise.all(
    devs.map(async (d, i) => {
      const seen: Wire[] = [];
      const step = async (): Promise<Wire[]> => {
        if (seen.length >= (wanted[i] ?? 0)) return seen;
        const message = await open(d.channel, await d.next());
        if (message !== null) seen.push(message);
        return step();
      };
      return step();
    }),
  );

test('pair, create a session, talk to the agent, sync the log', async () => {
  const { repo } = await setup();
  const d = await device();
  await expect(call(d, 'sessions.list', {})).rejects.toThrow('not_paired');
  const deviceId = await pair(d);
  expect(deviceId).toEqual(expect.any(String));
  expect(daemon.devices()).toHaveLength(1);
  expect(await call(d, 'hello', { protocol: 1 })).toEqual({
    protocol: 1,
    daemon: 'flux@test',
    sessions: [],
    vapidPublicKey: expect.stringMatching(/^B[\w-]{86}$/u),
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
  const status = (await call(d, 'git.status', { session })) as { files: unknown[] };
  expect(status.files).toEqual([]);
  expect(await call(d, 'fs.list', { session, path: '.' })).toEqual({
    entries: [{ name: 'README.md', kind: 'file' }],
  });
  await expect(call(d, 'fs.read', { session, path: '../x' })).rejects.toThrow('bad_params');
  expect(await call(d, 'sessions.cost', { session })).toMatchObject({ turns: 1 });
  await call(d, 'sessions.archive', { session });
  expect(await call(d, 'sessions.list', {})).toEqual([]);
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
  const { repos, claudeDir } = await setup();
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
