import { spawn as cpSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { Ephemeral, ShellStream } from '@flux/protocol';

import { DaemonError } from './daemon-error.ts';
import { inside } from './inside.ts';

// The operator command runner (ADR 0026): one-off, non-interactive command execution. Each run
// is an independent `sh -c <command>` child; nothing persists between commands. Output streams as
// the session-less `shell.output` / `shell.exited` ephemerals and is never logged. Bounded so a
// runaway cannot flood the box: 256 KiB total output and a 10-minute wall-clock both kill the
// process and set `truncated`. Every side effect (spawn, timers, uuid) is injected so tests are
// deterministic — the project bans real timers/sleeps in tests. Never an agent tool (§ 1).

const maxOutputBytes = 256 * 1024;
const wallClockMs = 10 * 60 * 1000;
const killGraceMs = 2_000;
// Output arriving within this window is emitted as one chunk, so a chatty command is not a frame
// storm (ADR 0026 § 4). The remainder always flushes when the process exits.
const coalesceMs = 30;

type KillSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

// The process boundary this module drives, so tests inject a fake without a real child.
export interface ShellChild {
  pid: number | undefined;
  onStdout: (fn: (chunk: string) => void) => void;
  onStderr: (fn: (chunk: string) => void) => void;
  onExit: (fn: (code: number | null, signal: string | null) => void) => void;
  kill: (signal: KillSignal) => void;
}

export type ShellSpawn = (command: string, cwd: string, env: Record<string, string>) => ShellChild;

// A one-shot timer that returns its own canceller; the only clock the runner needs.
export interface ShellClock {
  setTimer: (ms: number, fn: () => void) => () => void;
}

export interface ShellRunnerOptions {
  reposDir: string;
  emitEphemeral: (data: Ephemeral) => void;
  env?: Record<string, string | undefined>;
  spawn?: ShellSpawn;
  clock?: ShellClock;
  uuid?: () => string;
}

export interface ShellRunner {
  run: (params: { command: string; cwd?: string; deviceId: string }) => { runId: string };
  interrupt: (params: { runId: string; deviceId: string }) => void;
  // Kills a device's active run when it disconnects or is revoked — no orphaned processes (§ 6).
  disconnect: (deviceId: string) => void;
  // Kills every run; the daemon calls it on shutdown.
  stopAll: () => void;
}

interface Run {
  runId: string;
  deviceId: string;
  child: ShellChild;
  captured: number;
  truncated: boolean;
  exited: boolean;
  pending: { stdout: string; stderr: string };
  flushTimer: (() => void) | null;
  cancelWallClock: () => void;
  cancelEscalation: () => void;
}

interface State {
  reposDir: string;
  emit: (data: Ephemeral) => void;
  spawn: ShellSpawn;
  clock: ShellClock;
  uuid: () => string;
  env: Record<string, string | undefined>;
  runs: Map<string, Run>;
}

const noop = (): void => {};

const realClock: ShellClock = {
  setTimer: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

// The child inherits a COPY of the daemon env with every FLUX_* variable removed (so a command
// cannot trivially read Flux's secrets, ADR 0026 § 5) plus FORCE_COLOR=1 (so tools emit ANSI
// colour the client renders, since there is no PTY).
const childEnv = (env: Record<string, string | undefined>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('FLUX_') && value !== undefined) out[key] = value;
  }
  out['FORCE_COLOR'] = '1';
  return out;
};

const nodeSpawn: ShellSpawn = (command, cwd, env) => {
  // `detached` makes the child a process-group leader, so a signal to its negative pid reaches
  // everything the command spawned (a pipeline, a backgrounded job), not just the `sh` leader —
  // the daemon-wide kill pattern (close-child.ts, run-command.ts). Without it, interrupt, the
  // cap/timeout kill and the disconnect/shutdown teardown would leave orphans (ADR 0026 § 6).
  const child = cpSpawn('sh', ['-c', command], {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let onExit: ((code: number | null, signal: string | null) => void) | null = null;
  let onErr: ((chunk: string) => void) | null = null;
  // A spawn failure (a missing cwd, say) is reported as stderr then a null exit, so the run ends.
  child.on('error', (error: Error) => {
    onErr?.(error.message);
    onExit?.(null, null);
  });
  return {
    pid: child.pid,
    onStdout: (fn) => {
      child.stdout?.on('data', (b: Buffer) => {
        fn(b.toString('utf8'));
      });
    },
    onStderr: (fn) => {
      onErr = fn;
      child.stderr?.on('data', (b: Buffer) => {
        fn(b.toString('utf8'));
      });
    },
    onExit: (fn) => {
      onExit = fn;
      child.on('exit', (code, signal) => {
        fn(code, signal);
      });
    },
    kill: (signal) => {
      try {
        // The whole group by negative pid, so descendants die too; the bare pid only if the
        // spawn never got one. A group already gone raises ESRCH, the outcome wanted.
        if (child.pid === undefined) child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        // Already gone (ESRCH), the outcome wanted.
      }
    },
  };
};

const flush = (state: State, run: Run): void => {
  run.flushTimer = null;
  for (const stream of ['stdout', 'stderr'] as const) {
    const chunk = run.pending[stream];
    if (chunk.length === 0) continue;
    run.pending[stream] = '';
    state.emit({ type: 'shell.output', runId: run.runId, stream, chunk });
  }
};

const scheduleFlush = (state: State, run: Run): void => {
  if (run.flushTimer !== null) return;
  run.flushTimer = state.clock.setTimer(coalesceMs, () => {
    flush(state, run);
  });
};

// SIGINT→SIGTERM→SIGKILL (or SIGTERM→SIGKILL for a cap/timeout kill), each stage given a grace
// budget before the next (ADR 0017). A prior escalation is cancelled so signals do not overlap.
const terminate = (state: State, run: Run, signals: readonly KillSignal[]): void => {
  run.cancelEscalation();
  let i = 0;
  const step = (): void => {
    if (run.exited) return;
    const signal = signals[i];
    if (signal === undefined) return;
    run.child.kill(signal);
    i += 1;
    run.cancelEscalation = i < signals.length ? state.clock.setTimer(killGraceMs, step) : noop;
  };
  step();
};

const append = (state: State, run: Run, stream: ShellStream, chunk: string): void => {
  if (run.captured >= maxOutputBytes) return;
  const room = maxOutputBytes - run.captured;
  const text = chunk.length > room ? chunk.slice(0, room) : chunk;
  run.captured += text.length;
  run.pending[stream] += text;
  scheduleFlush(state, run);
  if (run.captured >= maxOutputBytes && !run.truncated) {
    run.truncated = true;
    terminate(state, run, ['SIGTERM', 'SIGKILL']);
  }
};

const onExit = (state: State, run: Run, code: number | null, signal: string | null): void => {
  if (run.exited) return;
  run.exited = true;
  run.cancelWallClock();
  run.cancelEscalation();
  run.flushTimer?.();
  flush(state, run);
  state.runs.delete(run.runId);
  state.emit({ type: 'shell.exited', runId: run.runId, code, signal, truncated: run.truncated });
};

const start = (state: State, params: { command: string; cwd?: string; deviceId: string }) => {
  const cwd = params.cwd === undefined ? state.reposDir : inside(state.reposDir, params.cwd);
  for (const existing of state.runs.values()) {
    if (existing.deviceId === params.deviceId) {
      throw new DaemonError('conflict', 'a command is already running on this device');
    }
  }
  const runId = state.uuid();
  const child = state.spawn(params.command, cwd, childEnv(state.env));
  const run: Run = {
    runId,
    deviceId: params.deviceId,
    child,
    captured: 0,
    truncated: false,
    exited: false,
    pending: { stdout: '', stderr: '' },
    flushTimer: null,
    cancelWallClock: noop,
    cancelEscalation: noop,
  };
  state.runs.set(runId, run);
  child.onStdout((chunk) => {
    append(state, run, 'stdout', chunk);
  });
  child.onStderr((chunk) => {
    append(state, run, 'stderr', chunk);
  });
  child.onExit((code, signal) => {
    onExit(state, run, code, signal);
  });
  run.cancelWallClock = state.clock.setTimer(wallClockMs, () => {
    if (run.exited) return;
    run.truncated = true;
    terminate(state, run, ['SIGTERM', 'SIGKILL']);
  });
  return { runId };
};

const interrupt = (state: State, params: { runId: string; deviceId: string }): void => {
  const run = state.runs.get(params.runId);
  // An unknown run, or one belonging to another device, is `not_found`: a device never learns of
  // or kills another device's run (ADR 0026 § 6).
  if (run === undefined || run.deviceId !== params.deviceId) {
    throw new DaemonError('not_found', 'no such run');
  }
  terminate(state, run, ['SIGINT', 'SIGTERM', 'SIGKILL']);
};

const killWhere = (state: State, matches: (run: Run) => boolean): void => {
  for (const run of state.runs.values()) if (matches(run)) run.child.kill('SIGKILL');
};

export const createShellRunner = (options: ShellRunnerOptions): ShellRunner => {
  const state: State = {
    reposDir: options.reposDir,
    emit: options.emitEphemeral,
    spawn: options.spawn ?? nodeSpawn,
    clock: options.clock ?? realClock,
    uuid: options.uuid ?? randomUUID,
    env: options.env ?? process.env,
    runs: new Map(),
  };
  return {
    run: (params) => start(state, params),
    interrupt: (params) => {
      interrupt(state, params);
    },
    disconnect: (deviceId) => {
      killWhere(state, (run) => run.deviceId === deviceId);
    },
    stopAll: () => {
      killWhere(state, () => true);
    },
  };
};
