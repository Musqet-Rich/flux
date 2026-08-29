import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import type { AgentProcess } from './spawn-claude.ts';
import { spawnClaude } from './spawn-claude.ts';

// The process boundary is mocked with a fixture-replaying script (engineering.md § Testing);
// everything on this side of it is real.

const fake = fileURLToPath(new URL('../../test/fake-claude.ts', import.meta.url));
const fixture = fileURLToPath(
  new URL('../../test/fixtures/claude/session-two-turns.jsonl', import.meta.url),
);

const stubborn = fileURLToPath(new URL('../../test/stubborn-agent.ts', import.meta.url));

const start = (extra: NodeJS.ProcessEnv = {}, command = fake): AgentProcess =>
  spawnClaude({
    cwd: process.cwd(),
    command,
    env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, ...extra },
    close: { graceMs: 100 },
  });

// Collects lines until a `result` line arrives, which ends a turn.
const turn = (agent: AgentProcess): Promise<string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    agent.onLine((line) => {
      lines.push(line);
      if (line.includes('"type":"result"')) resolve(lines.splice(0));
    });
  });

test('replays one fixture turn per user message and exits cleanly on close', async () => {
  const agent = start();
  const first = turn(agent);
  agent.send('first');
  const lines = await first;
  expect(lines.some((l) => l.includes('"subtype":"init"'))).toBe(true);
  expect(lines.at(-1)).toContain('"type":"result"');
  expect(await agent.close()).toBe(0);
});

test('reports an unexpected exit', async () => {
  const agent = start({ FLUX_FAKE_EXIT_AFTER_TURNS: '1' });
  const exit = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  agent.send('go');
  expect(await exit).toBe(1);
  expect(await agent.close()).toBe(1);
});

// The stubborn agent prints `ready` once its SIGTERM handler is installed.
const ready = (agent: AgentProcess): Promise<string> =>
  new Promise((resolve) => {
    agent.onLine(resolve);
  });

// An agent blocked inside an MCP call ignores stdin EOF and SIGTERM; kill is SIGKILL of its
// group and does not wait, close escalates to it and still returns.
test('kill ends an agent that ignores SIGTERM', async () => {
  const agent = start({}, stubborn);
  const exit = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  expect(await ready(agent)).toBe('ready');
  agent.kill();
  expect(await exit).toBeNull();
});

test('close ends an agent that ignores EOF and SIGTERM', async () => {
  const agent = start({}, stubborn);
  const exit = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  expect(await ready(agent)).toBe('ready');
  expect(await agent.close()).toBeNull();
  expect(await exit).toBeNull();
});
