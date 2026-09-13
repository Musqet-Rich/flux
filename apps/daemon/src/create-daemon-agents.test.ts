import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { daemonDevice } from '../test/daemon-device.ts';
import type { FakeRelay } from '../test/fake-relay.ts';
import { startFakeRelay } from '../test/fake-relay.ts';
import type { FrameRouter } from '../test/frame-router.ts';
import { frameRouter } from '../test/frame-router.ts';
import { tempRepo } from '../test/temp-repo.ts';
import type { Daemon } from './create-daemon.ts';
import { createDaemon } from './create-daemon.ts';

// Saved Agents end to end (ADR 0023 § 2): the whole daemon against a fake relay and the fake
// agent, exercising the create-time resolution (inline → agent → default) and the settings guard.

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
  daemon = await createDaemon({
    dataDir: join(root, 'data'),
    relayUrl: relay.url,
    reposDir: repos,
    daemonName: 'flux@test',
    pushSubject: 'mailto:ops@example.com',
    claudeCommand: fake,
    piCommand: 'no-such-binary-anywhere',
    opencodeCommand: 'no-such-binary-anywhere',
    claudeDir: join(root, 'claude'),
    home: root,
  });
  await daemon.start();
  await relay.host();
  return { root, repo };
};

const { device, call, pair, untilEvent } = daemonDevice({
  daemon: () => daemon,
  relay: () => relay,
  frames: () => frames,
});

test('saved agents round-trip through settings and a duplicate name is bad_params', async () => {
  await setup();
  const d = await device();
  await pair(d);
  // A fresh box is seeded with the default read-only "Help" Agent on first daemon start.
  const seeded = ((await call(d, 'settings.get', {})) as { agents: unknown[] }).agents;
  expect(seeded).toHaveLength(1);
  expect(seeded).toMatchObject([
    { name: 'Help', harness: 'claude', tools: { mode: 'deny', list: ['Bash', 'Edit', 'Write'] } },
  ]);
  const saved = await call(d, 'settings.set', {
    agents: [{ name: 'reviewer', harness: 'claude', model: 'opus', role: 'be terse' }],
  });
  expect(saved).toMatchObject({
    agents: [{ name: 'reviewer', harness: 'claude', model: 'opus', role: 'be terse' }],
  });
  expect(await call(d, 'settings.get', {})).toEqual(saved);
  await expect(
    call(d, 'settings.set', { agents: [{ name: 'dup' }, { name: 'dup' }] }),
  ).rejects.toThrow('bad_params');
});

test('a saved agent seeds a session, inline model wins, and an unknown agent is bad_params', async () => {
  const { repo } = await setup();
  const d = await device();
  await pair(d);
  await call(d, 'settings.set', {
    agents: [{ name: 'reviewer', model: 'opus', effort: 'high', role: 'be terse' }],
  });
  const fromAgent = (await call(d, 'sessions.create', {
    repo,
    branch: 'flux/a1',
    harness: 'claude',
    agent: 'reviewer',
  })) as { model?: string; effort?: string };
  // The resolved model/effort ride on the summary; role stays box-side, not on the wire.
  expect(fromAgent).toMatchObject({ model: 'opus', effort: 'high' });
  expect('role' in fromAgent).toBe(false);
  const override = (await call(d, 'sessions.create', {
    repo,
    branch: 'flux/a2',
    harness: 'claude',
    agent: 'reviewer',
    model: 'sonnet',
  })) as { model?: string; effort?: string };
  expect(override).toMatchObject({ model: 'sonnet', effort: 'high' });
  await expect(
    call(d, 'sessions.create', { repo, branch: 'flux/a3', harness: 'claude', agent: 'ghost' }),
  ).rejects.toThrow('bad_params');
});

test('sessions.create resolves the repo under reposDir in the handler, still refusing traversal', async () => {
  await setup();
  const d = await device();
  await pair(d);
  // Repo resolution moved out of createSession into the wire handler (the help path bypasses it);
  // the `inside`-under-reposDir guard still runs here, so a path escaping reposDir is bad_params
  // before any worktree is cut.
  await expect(
    call(d, 'sessions.create', { repo: '/etc', branch: 'flux/x', harness: 'claude' }),
  ).rejects.toThrow('bad_params');
  await expect(
    call(d, 'sessions.create', { repo: '../outside', branch: 'flux/y', harness: 'claude' }),
  ).rejects.toThrow('bad_params');
});

// The fake agent writes its argv to FLUX_FAKE_ARGS_FILE at each start.
const flagsOf = async (file: string): Promise<string[]> => {
  const args: unknown = JSON.parse(await readFile(file, 'utf8'));
  return Array.isArray(args) ? args.filter((a) => typeof a === 'string') : [];
};

const valueOf = (args: string[], flag: string): string | undefined =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;

test('a restart with a model and effort respawns with the flags; null clears one (ADR 0032)', async () => {
  const { root, repo } = await setup();
  const argsFile = join(root, 'args.json');
  process.env['FLUX_FAKE_ARGS_FILE'] = argsFile;
  const d = await device();
  await pair(d);
  const { session } = (await call(d, 'sessions.create', {
    repo,
    branch: 'flux/r1',
    harness: 'claude',
    model: 'opus',
  })) as { session: string };
  await call(d, 'agent.send', { session, text: 'go' });
  await untilEvent(d, 'turn.ended');
  let args = await flagsOf(argsFile);
  expect([valueOf(args, '--model'), valueOf(args, '--effort')]).toEqual(['opus', undefined]);
  await call(d, 'sessions.restart', { session, model: 'sonnet', effort: 'low' });
  await call(d, 'agent.send', { session, text: 'again' });
  await untilEvent(d, 'turn.ended');
  args = await flagsOf(argsFile);
  expect([valueOf(args, '--model'), valueOf(args, '--effort')]).toEqual(['sonnet', 'low']);
  await call(d, 'sessions.restart', { session, model: null });
  await call(d, 'agent.send', { session, text: 'once more' });
  await untilEvent(d, 'turn.ended');
  args = await flagsOf(argsFile);
  expect([valueOf(args, '--model'), valueOf(args, '--effort')]).toEqual([undefined, 'low']);
  const listed = (await call(d, 'sessions.list', {})) as { session: string; model?: string }[];
  expect(listed.find((s) => s.session === session)).not.toHaveProperty('model');
  expect(listed.find((s) => s.session === session)).toMatchObject({ effort: 'low' });
  delete process.env['FLUX_FAKE_ARGS_FILE'];
});

// The box lists the harnesses it found; the rest cannot start a session or be the default.
test('refuses to create a session for a harness the box does not have', async () => {
  const { repo } = await setup();
  const d = await device();
  await pair(d);
  await expect(
    call(d, 'sessions.create', { repo, branch: 'flux/pi', harness: 'pi' }),
  ).rejects.toThrow('agent_unavailable');
  await expect(call(d, 'settings.set', { flux: { defaultHarness: 'pi' } })).rejects.toThrow(
    'agent_unavailable',
  );
  expect(await call(d, 'settings.set', { flux: { defaultHarness: 'claude' } })).toMatchObject({
    flux: { defaultHarness: 'claude' },
  });
});
