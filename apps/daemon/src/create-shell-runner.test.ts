import type { Ephemeral } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { ShellChild, ShellClock, ShellSpawn } from './create-shell-runner.ts';
import { createShellRunner } from './create-shell-runner.ts';
import { DaemonError } from './daemon-error.ts';

// The runner drives an injected process boundary and clock, so every path — streaming, the
// 256 KiB and 10-minute bounds, interrupt escalation, per-device isolation and disconnect — is
// deterministic without a real child or a real timer (engineering.md § Testing).

type ShellOutput = Extract<Ephemeral, { type: 'shell.output' }>;
type ShellExited = Extract<Ephemeral, { type: 'shell.exited' }>;

const noop = (): void => {};

interface Ctl {
  child: ShellChild;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  exit: (code: number | null, signal: string | null) => void;
  kills: string[];
}

const ctl = (): Ctl => {
  let onOut: (s: string) => void = noop;
  let onErr: (s: string) => void = noop;
  let onExit: (code: number | null, signal: string | null) => void = noop;
  const kills: string[] = [];
  return {
    child: {
      pid: 1,
      onStdout: (fn) => {
        onOut = fn;
      },
      onStderr: (fn) => {
        onErr = fn;
      },
      onExit: (fn) => {
        onExit = fn;
      },
      kill: (signal) => {
        kills.push(signal);
      },
    },
    stdout: (s) => {
      onOut(s);
    },
    stderr: (s) => {
      onErr(s);
    },
    exit: (code, signal) => {
      onExit(code, signal);
    },
    kills,
  };
};

interface FakeTimer {
  ms: number;
  fn: () => void;
  live: boolean;
}

const fakeClock = (): { clock: ShellClock; fire: (ms: number) => void } => {
  const timers: FakeTimer[] = [];
  return {
    clock: {
      setTimer: (ms, fn) => {
        const timer: FakeTimer = { ms, fn, live: true };
        timers.push(timer);
        return () => {
          timer.live = false;
        };
      },
    },
    // Fire every timer that is live at call time; timers scheduled by the fired callbacks wait
    // for the next `fire`, so escalation advances one stage per call.
    fire: (ms) => {
      const due = timers.filter((timer) => timer.live && timer.ms === ms);
      for (const timer of due) {
        timer.live = false;
        timer.fn();
      }
    },
  };
};

interface Spawned {
  command: string;
  cwd: string;
  env: Record<string, string>;
  ctl: Ctl;
}

const harness = (reposDir = '/repos') => {
  const events: Ephemeral[] = [];
  const spawns: Spawned[] = [];
  const clock = fakeClock();
  let n = 0;
  const spawn: ShellSpawn = (command, cwd, env) => {
    const c = ctl();
    spawns.push({ command, cwd, env, ctl: c });
    return c.child;
  };
  const runner = createShellRunner({
    reposDir,
    emitEphemeral: (data) => {
      events.push(data);
    },
    env: { PATH: '/bin', HOME: '/home', FLUX_SECRET: 'shh', FLUX_RELAY_URL: 'wss://r' },
    spawn,
    clock: clock.clock,
    uuid: () => `run-${(n += 1)}`,
  });
  return { runner, events, spawns, fire: clock.fire };
};

const outputs = (events: Ephemeral[]): ShellOutput[] =>
  events.filter((e): e is ShellOutput => e.type === 'shell.output');
const exits = (events: Ephemeral[]): ShellExited[] =>
  events.filter((e): e is ShellExited => e.type === 'shell.exited');

test('spawns sh -c with cwd defaulting to reposDir, a scrubbed env and FORCE_COLOR', () => {
  const { runner, spawns } = harness('/repos');
  const { runId } = runner.run({ command: 'echo hi', deviceId: 'd1' });
  expect(runId).toBe('run-1');
  const spawned = spawns[0];
  expect(spawned?.command).toBe('echo hi');
  expect(spawned?.cwd).toBe('/repos');
  // The exact match already proves no FLUX_* key survived the scrub and that FORCE_COLOR was set.
  expect(spawned?.env).toEqual({ PATH: '/bin', HOME: '/home', FORCE_COLOR: '1' });
});

test('an optional cwd inside reposDir resolves; one outside is bad_params', () => {
  const { runner, spawns } = harness('/repos');
  runner.run({ command: 'ls', cwd: 'a/b', deviceId: 'd1' });
  expect(spawns[0]?.cwd).toBe('/repos/a/b');
  const outside = () => runner.run({ command: 'ls', cwd: '../etc', deviceId: 'd2' });
  expect(outside).toThrow(DaemonError);
  expect(outside).toThrow(/escapes/u);
});

test('streams stdout then stderr in order and reports the exit code', () => {
  const { runner, events, spawns, fire } = harness();
  runner.run({ command: 'go', deviceId: 'd1' });
  const c = spawns[0]?.ctl;
  c?.stdout('one');
  fire(30);
  c?.stderr('two');
  fire(30);
  c?.exit(0, null);
  expect(outputs(events)).toEqual([
    { type: 'shell.output', runId: 'run-1', stream: 'stdout', chunk: 'one' },
    { type: 'shell.output', runId: 'run-1', stream: 'stderr', chunk: 'two' },
  ]);
  expect(exits(events)).toEqual([
    { type: 'shell.exited', runId: 'run-1', code: 0, signal: null, truncated: false },
  ]);
});

test('coalesces output that arrives within the flush window into one chunk', () => {
  const { runner, events, spawns, fire } = harness();
  runner.run({ command: 'go', deviceId: 'd1' });
  const c = spawns[0]?.ctl;
  c?.stdout('a');
  c?.stdout('b');
  c?.stdout('c');
  fire(30);
  expect(outputs(events)).toEqual([
    { type: 'shell.output', runId: 'run-1', stream: 'stdout', chunk: 'abc' },
  ]);
});

test('flushes buffered output on exit even without a flush tick', () => {
  const { runner, events, spawns } = harness();
  runner.run({ command: 'go', deviceId: 'd1' });
  const c = spawns[0]?.ctl;
  c?.stdout('tail');
  c?.exit(0, null);
  expect(outputs(events)).toEqual([
    { type: 'shell.output', runId: 'run-1', stream: 'stdout', chunk: 'tail' },
  ]);
  expect(exits(events)[0]?.truncated).toBe(false);
});

test('caps total output at 256 KiB, kills the process and marks truncated', () => {
  const { runner, events, spawns, fire } = harness();
  runner.run({ command: 'yes', deviceId: 'd1' });
  const c = spawns[0]?.ctl;
  c?.stdout('x'.repeat(256 * 1024 + 50));
  expect(c?.kills).toEqual(['SIGTERM']);
  fire(2000);
  expect(c?.kills).toEqual(['SIGTERM', 'SIGKILL']);
  fire(30);
  expect(outputs(events)[0]?.chunk.length).toBe(256 * 1024);
  c?.exit(null, 'SIGKILL');
  expect(exits(events)).toEqual([
    { type: 'shell.exited', runId: 'run-1', code: null, signal: 'SIGKILL', truncated: true },
  ]);
});

test('kills a run that overruns the 10-minute wall clock and marks truncated', () => {
  const { runner, events, spawns, fire } = harness();
  runner.run({ command: 'sleep 999999', deviceId: 'd1' });
  const c = spawns[0]?.ctl;
  fire(10 * 60 * 1000);
  expect(c?.kills).toEqual(['SIGTERM']);
  c?.exit(null, 'SIGTERM');
  expect(exits(events)[0]?.truncated).toBe(true);
});

test('interrupt escalates SIGINT then SIGTERM then SIGKILL', () => {
  const { runner, spawns, fire } = harness();
  const { runId } = runner.run({ command: 'go', deviceId: 'd1' });
  const c = spawns[0]?.ctl;
  runner.interrupt({ runId, deviceId: 'd1' });
  expect(c?.kills).toEqual(['SIGINT']);
  fire(2000);
  fire(2000);
  expect(c?.kills).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
});

test('escalation stops once the process has exited', () => {
  const { runner, spawns, fire } = harness();
  const { runId } = runner.run({ command: 'go', deviceId: 'd1' });
  const c = spawns[0]?.ctl;
  runner.interrupt({ runId, deviceId: 'd1' });
  c?.exit(null, 'SIGINT');
  fire(2000);
  expect(c?.kills).toEqual(['SIGINT']);
});

test('interrupt refuses another device’s run and an unknown run without killing', () => {
  const { runner, spawns } = harness();
  const { runId } = runner.run({ command: 'go', deviceId: 'd1' });
  const c = spawns[0]?.ctl;
  expect(() => {
    runner.interrupt({ runId, deviceId: 'd2' });
  }).toThrow(/no such run/u);
  expect(() => {
    runner.interrupt({ runId: 'nope', deviceId: 'd1' });
  }).toThrow(DaemonError);
  expect(c?.kills).toEqual([]);
});

test('refuses a second concurrent run for the same device but allows another device', () => {
  const { runner } = harness();
  runner.run({ command: 'a', deviceId: 'd1' });
  expect(() => runner.run({ command: 'b', deviceId: 'd1' })).toThrow(/already running/u);
  expect(() => runner.run({ command: 'c', deviceId: 'd2' })).not.toThrow();
});

test('a device may run again once its previous run has exited', () => {
  const { runner, spawns } = harness();
  const first = runner.run({ command: 'a', deviceId: 'd1' });
  spawns[0]?.ctl.exit(0, null);
  const second = runner.run({ command: 'b', deviceId: 'd1' });
  expect(second.runId).not.toBe(first.runId);
});

test('disconnect kills only the disconnecting device’s run', () => {
  const { runner, spawns } = harness();
  runner.run({ command: 'a', deviceId: 'd1' });
  runner.run({ command: 'b', deviceId: 'd2' });
  runner.disconnect('d1');
  expect(spawns[0]?.ctl.kills).toEqual(['SIGKILL']);
  expect(spawns[1]?.ctl.kills).toEqual([]);
});

test('stopAll kills every active run', () => {
  const { runner, spawns } = harness();
  runner.run({ command: 'a', deviceId: 'd1' });
  runner.run({ command: 'b', deviceId: 'd2' });
  runner.stopAll();
  expect(spawns[0]?.ctl.kills).toEqual(['SIGKILL']);
  expect(spawns[1]?.ctl.kills).toEqual(['SIGKILL']);
});
