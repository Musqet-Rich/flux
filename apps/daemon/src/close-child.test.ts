import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { closeChild } from './close-child.ts';

// The process boundary is real: a fixture-replaying agent that leaves on stdin EOF, and one
// that ignores EOF and SIGTERM alike, as an agent blocked inside an MCP call does.

const fake = fileURLToPath(new URL('../test/fake-claude.ts', import.meta.url));
const stubborn = fileURLToPath(new URL('../test/stubborn-agent.ts', import.meta.url));
const fixture = fileURLToPath(
  new URL('../test/fixtures/claude/session-two-turns.jsonl', import.meta.url),
);

const start = (command: string) => {
  const child = spawn(command, [], {
    env: { ...process.env, FLUX_FAKE_FIXTURE: fixture },
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true,
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', resolve);
  });
  const stages: string[] = [];
  return {
    child,
    exited,
    stages,
    log: (stage: string) => {
      stages.push(stage);
    },
  };
};

const gone = (pid: number | undefined): boolean => {
  try {
    if (pid !== undefined) process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

test('an agent that leaves on stdin EOF is closed at the first stage', async () => {
  const { child, exited, stages, log } = start(fake);
  expect(await closeChild(child, exited, { graceMs: 5000, log })).toBe(0);
  expect(stages).toEqual(['stdin closed']);
  expect(gone(child.pid)).toBe(true);
});

test('an agent that ignores EOF and SIGTERM is killed within the bound', async () => {
  const { child, exited, stages, log } = start(stubborn);
  await new Promise<void>((resolve) => {
    child.once('spawn', resolve);
  });
  expect(await closeChild(child, exited, { graceMs: 100, log })).toBeNull();
  expect(stages).toEqual(['stdin closed', 'SIGTERM', 'SIGKILL']);
  expect(gone(child.pid)).toBe(true);
});

test('closing an agent that has already exited takes no stage', async () => {
  const { child, exited, stages, log } = start(fake);
  child.stdin?.end();
  await exited;
  expect(await closeChild(child, exited, { graceMs: 100, log })).toBe(0);
  expect(stages).toEqual([]);
});
