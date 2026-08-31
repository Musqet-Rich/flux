import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { expect, test } from 'vitest';

import { spawnOpencode } from './spawn-opencode.ts';

// The spawn function is injected so the argv, env and process-per-turn lifecycle are asserted
// without ever running the real opencode (it hangs headless, ADR 0027). The fake child is a tiny
// hand-rolled emitter (no EventEmitter): it has no pid, so close-child.ts / kill-child-group.ts
// signal it directly and it exits on the first signal.

type DataListener = (chunk: Buffer) => void;

const stream = (): {
  on: (event: 'data', cb: DataListener) => void;
  emit: (chunk: Buffer) => void;
} => {
  const listeners: DataListener[] = [];
  return {
    on: (_event, cb) => {
      listeners.push(cb);
    },
    emit: (chunk) => {
      for (const cb of listeners) cb(chunk);
    },
  };
};

class FakeChild {
  pid: number | undefined = undefined;
  stdout = stream();
  stderr = stream();
  stdin: undefined = undefined;
  killed = false;
  private exitListeners: ((code: number | null) => void)[] = [];
  on(event: string, cb: (code: number | null) => void): this {
    if (event === 'exit') this.exitListeners.push(cb);
    return this;
  }
  once(event: string, cb: (code: number | null) => void): this {
    return this.on(event, cb);
  }
  emitLine(line: string): void {
    this.stdout.emit(Buffer.from(`${line}\n`));
  }
  exit(code: number | null): void {
    if (this.killed) return;
    this.killed = true;
    for (const cb of this.exitListeners) cb(code);
  }
  kill(): boolean {
    this.exit(null);
    return true;
  }
}

interface Rig {
  calls: { args: string[]; options: SpawnOptions }[];
  children: FakeChild[];
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
}

const rig = (): Rig => {
  const calls: Rig['calls'] = [];
  const children: FakeChild[] = [];
  const spawn = (_command: string, args: string[], options: SpawnOptions): ChildProcess => {
    const child = new FakeChild();
    calls.push({ args, options });
    children.push(child);
    return child as unknown as ChildProcess;
  };
  return { calls, children, spawn };
};

const exitOf = (child: FakeChild): Promise<number | null> =>
  new Promise((resolve) => {
    child.on('exit', resolve);
  });

const stepStart = (session: string): string =>
  JSON.stringify({ type: 'step_start', sessionID: session, part: {} });
const stepFinishStop = JSON.stringify({
  type: 'step_finish',
  part: {
    reason: 'stop',
    tokens: { input: 1, output: 1, cache: { write: 0, read: 0 } },
    cost: 0.1,
  },
});

test('the first send builds the create argv and passes OPENCODE_CONFIG in the env', () => {
  const { calls, spawn } = rig();
  const agent = spawnOpencode({
    cwd: '/w',
    spawn,
    env: { OPENCODE_CONFIG: '/data/opencode/s.json' },
    model: 'anthropic/claude-sonnet-4',
    effort: 'high',
  });
  agent.send('do the thing');
  expect(calls[0]?.args).toEqual([
    'run',
    '--format',
    'json',
    '--auto',
    '--dir',
    '/w',
    '--model',
    'anthropic/claude-sonnet-4',
    '--variant',
    'high',
    'do the thing',
  ]);
  expect(calls[0]?.options.env?.['OPENCODE_CONFIG']).toBe('/data/opencode/s.json');
  expect(calls[0]?.options.detached).toBe(true);
});

test('after the first run reports a session id the next send continues it', () => {
  const { calls, children, spawn } = rig();
  const agent = spawnOpencode({ cwd: '/w', spawn });
  agent.send('first');
  children[0]?.emitLine(stepStart('ses_abc'));
  children[0]?.emitLine(stepFinishStop);
  children[0]?.exit(0);
  agent.send('second');
  expect(calls[1]?.args).toEqual([
    'run',
    '--session',
    'ses_abc',
    '--continue',
    '--format',
    'json',
    '--auto',
    '--dir',
    '/w',
    'second',
  ]);
});

test('a resume id continues from the very first send', () => {
  const { calls, spawn } = rig();
  const agent = spawnOpencode({ cwd: '/w', spawn, resume: 'ses_prior' });
  agent.send('go');
  expect(calls[0]?.args.slice(0, 4)).toEqual(['run', '--session', 'ses_prior', '--continue']);
});

test('a normal run-exit at a turn boundary does NOT fire onExit; the wrapper stays alive', () => {
  const { children, spawn } = rig();
  const agent = spawnOpencode({ cwd: '/w', spawn });
  let exited = false;
  agent.onExit(() => {
    exited = true;
  });
  agent.send('go');
  children[0]?.emitLine(stepStart('ses_1'));
  children[0]?.emitLine(stepFinishStop);
  children[0]?.exit(0);
  expect(exited).toBe(false);
  agent.send('again');
  expect(children).toHaveLength(2);
});

test('a crash (non-zero exit with no step_finish) fires onExit with the code', async () => {
  const { children, spawn } = rig();
  const agent = spawnOpencode({ cwd: '/w', spawn });
  const code = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  agent.send('go');
  children[0]?.stderr.emit(Buffer.from('opencode: auth failed'));
  children[0]?.exit(1);
  expect(await code).toBe(1);
  expect(agent.stderr()).toContain('auth failed');
});

test('close ends the current run and fires onExit', async () => {
  const { children, spawn } = rig();
  const agent = spawnOpencode({ cwd: '/w', spawn, close: { graceMs: 5 } });
  const code = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  agent.send('go');
  const closed = agent.close();
  await exitOf(children[0] as FakeChild);
  expect(await code).toBeNull();
  expect(await closed).toBeNull();
  expect(children[0]?.killed).toBe(true);
});

test('interrupt kills the current run but keeps the wrapper for the next turn', async () => {
  const { children, spawn } = rig();
  const agent = spawnOpencode({ cwd: '/w', spawn, close: { graceMs: 5 } });
  let exited = false;
  agent.onExit(() => {
    exited = true;
  });
  agent.send('go');
  agent.interrupt();
  await exitOf(children[0] as FakeChild);
  expect(children[0]?.killed).toBe(true);
  expect(exited).toBe(false);
  agent.send('again');
  expect(children).toHaveLength(2);
});

test('kill with no active run fires onExit at once', () => {
  const { spawn } = rig();
  const agent = spawnOpencode({ cwd: '/w', spawn });
  let code: number | null | undefined;
  let fired = false;
  agent.onExit((c) => {
    fired = true;
    code = c;
  });
  agent.kill();
  expect(fired).toBe(true);
  expect(code).toBeNull();
});
