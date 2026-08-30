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
    claudeDir: join(root, 'claude'),
  });
  await daemon.start();
  await relay.host();
  return { repo };
};

const { device, call, pair } = daemonDevice({
  daemon: () => daemon,
  relay: () => relay,
  frames: () => frames,
});

test('saved agents round-trip through settings and a duplicate name is bad_params', async () => {
  await setup();
  const d = await device();
  await pair(d);
  expect(((await call(d, 'settings.get', {})) as { agents: unknown[] }).agents).toEqual([]);
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
