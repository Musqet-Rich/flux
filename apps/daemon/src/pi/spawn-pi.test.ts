import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import type { AgentProcess } from '../claude/spawn-claude.ts';
import { piFixture } from '../../test/pi-harness.ts';
import { spawnPi } from './spawn-pi.ts';

// The process boundary is mocked with the fixture-replaying fake pi (engineering.md § Testing);
// the arguments, the JSONL splitter and the stdin commands on this side are real.

const fake = fileURLToPath(new URL('../../test/fake-pi.ts', import.meta.url));

const start = (extra: NodeJS.ProcessEnv = {}, fixtures = ['text-reply']): AgentProcess =>
  spawnPi({
    cwd: process.cwd(),
    session: 'sess-1',
    sessionDir: '/data/pi-sessions',
    command: fake,
    extension: '/ext/flux-pi-extension.ts',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    env: {
      ...process.env,
      FLUX_FAKE_FIXTURE: fixtures.map((f) => piFixture(f)).join(','),
      ...extra,
    },
  });

// Resolves when a line containing `needle` arrives.
const untilLine = (agent: AgentProcess, needle: string): Promise<void> =>
  new Promise((resolve) => {
    agent.onLine((line) => {
      if (line.includes(needle)) resolve();
    });
  });

// Collects lines until the run settles.
const run = (agent: AgentProcess): Promise<string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    agent.onLine((line) => {
      lines.push(line);
      if (line.includes('"agent_settled"')) resolve(lines.splice(0));
    });
  });

test('passes the rpc, session, trust and extension arguments and replays one run per prompt', async () => {
  const argsFile = join(tmpdir(), `flux-pi-args-${process.pid}.json`);
  const agent = start({ FLUX_FAKE_ARGS_FILE: argsFile });
  const first = run(agent);
  agent.send('first');
  const lines = await first;
  expect(lines[0]).toContain('"command":"prompt"');
  expect(lines.at(-1)).toContain('"agent_settled"');
  expect(await agent.close()).toBe(0);
  expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual([
    '--mode',
    'rpc',
    '--session-dir',
    '/data/pi-sessions',
    '--session-id',
    'sess-1',
    '--no-approve',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--provider',
    'anthropic',
    '--model',
    'claude-haiku-4-5',
    '--extension',
    '/ext/flux-pi-extension.ts',
    '--append-system-prompt',
    expect.stringContaining('flux_ask'),
  ]);
});

test('interrupt sends abort and the run still settles; the process stays alive for the next prompt', async () => {
  const agent = start({}, ['interrupt', 'text-reply']);
  const seen: string[] = [];
  agent.onLine((line) => {
    seen.push(line);
  });
  const first = run(agent);
  agent.send('go');
  await untilLine(agent, '"message_update"');
  agent.interrupt();
  await first;
  const second = run(agent);
  agent.send('again');
  await second;
  expect(seen.filter((l) => l.includes('"agent_settled"'))).toHaveLength(2);
  expect(await agent.close()).toBe(0);
});

test('reports an unexpected exit and kill ends the process', async () => {
  const agent = start({ FLUX_FAKE_EXIT_AFTER_TURNS: '1' });
  const exit = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  agent.send('go');
  expect(await exit).toBe(1);
  const killed = start();
  const gone = new Promise<number | null>((resolve) => {
    killed.onExit(resolve);
  });
  killed.kill();
  expect(await gone).toBeNull();
});

test('a dialog request is cancelled at once so the run goes on', async () => {
  const agent = start({ FLUX_FAKE_UI_REQUEST: '1' });
  const seen: string[] = [];
  agent.onLine((line) => {
    seen.push(line);
  });
  const first = run(agent);
  agent.send('go');
  await first;
  expect(seen[0]).toContain('"extension_ui_request"');
  expect(seen[1]).toContain('"cancelled":true');
  expect(await agent.close()).toBe(0);
});

test('the tail of stderr is kept for the session end reason', async () => {
  const agent = start({
    FLUX_FAKE_STDERR_FILE: piFixture('bad-model').replace(/\.jsonl$/u, '.stderr.txt'),
    FLUX_FAKE_EXIT_AFTER_TURNS: '1',
  });
  const exit = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  agent.send('go');
  expect(await exit).toBe(1);
  expect(agent.stderr()).toContain('Model "no-such-model" not found');
});

const echo = fileURLToPath(new URL('../../test/echo-agent.ts', import.meta.url));

// pi's rpc.md: a prompt carries images as `images: [{ type: 'image', data, mimeType }]`.
test('images go on the prompt as pi expects them', async () => {
  const agent = spawnPi({
    cwd: process.cwd(),
    session: 's',
    sessionDir: process.cwd(),
    command: echo,
    close: { graceMs: 100 },
  });
  const line = new Promise<string>((resolve) => {
    agent.onLine(resolve);
  });
  agent.send('look', [{ mediaType: 'image/png', data: 'AA==' }]);
  expect(JSON.parse(await line)).toEqual({
    type: 'prompt',
    message: 'look',
    streamingBehavior: 'followUp',
    images: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
  });
  await agent.close();
});
