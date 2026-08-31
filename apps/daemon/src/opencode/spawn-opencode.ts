import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import type { AgentProcess } from '../claude/spawn-claude.ts';
import type { CloseChildOptions } from '../close-child.ts';
import { closeChild } from '../close-child.ts';
import { killChildGroup } from '../kill-child-group.ts';
import { parseOpencodeLine } from './parse-opencode-line.ts';

// Write side of the opencode adapter (ADR 0027 § 3): PROCESS-PER-TURN. opencode `run` is invoked
// once per turn, not a long-lived child reading stdin (claude/pi). This `AgentProcess` is a
// wrapper that stays LOGICALLY ALIVE across turns: `send` spawns a fresh `run` for the stored
// opencode session id and forwards that run's NDJSON via `onLine`. A run that reaches its terminal
// `step_finish{reason:"stop"}` and then exits is a completed turn (the supervisor already learns
// turn-end from the mapped `turn.ended`), so its exit is SWALLOWED. A run that exits WITHOUT
// reaching that stop step — a provider 5xx, an OOM, a segfault mid-turn — is a crash and fires
// `onExit` with the code so the supervisor can end the session; otherwise it would wedge in
// `running` forever. `onExit` also fires on `close`/`kill`. Only one run is ever live at a time:
// a `send` while a run is active is QUEUED behind it (never spawned concurrently against the same
// `--session`), and the per-run interrupt/stop flags live on the run, not the wrapper, so an
// interrupt can never be mis-attributed to a different child's exit.

type OpencodeSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface SpawnOpencodeOptions {
  cwd: string;
  command?: string;
  // The opencode session id (`ses_…`, ADR 0027 § 3) to continue; unset creates one on the first
  // run and the wrapper captures the new id from that run's `step_start` for later turns.
  resume?: string;
  model?: string;
  // Configured effort (ADR 0023 § 3), passed as opencode's `--variant` when set.
  effort?: string;
  // Carries `OPENCODE_CONFIG` (the tools floor + role, ADR 0027 § 4/§ 5) into every run.
  env?: NodeJS.ProcessEnv;
  close?: CloseChildOptions;
  // Injectable so tests assert argv/env and feed a fake child's stdout without a real opencode:
  // `opencode run` hangs headless (ADR 0027), so it is never spawned in a test.
  spawn?: OpencodeSpawn;
}

const runArgs = (
  options: SpawnOpencodeOptions,
  sessionId: string | null,
  text: string,
): string[] => [
  'run',
  ...(sessionId === null ? [] : ['--session', sessionId, '--continue']),
  '--format',
  'json',
  '--auto',
  '--dir',
  options.cwd,
  ...(options.model === undefined ? [] : ['--model', options.model]),
  ...(options.effort === undefined ? [] : ['--variant', options.effort]),
  text,
];

// opencode's stdout is LF-delimited JSON; split by hand (as spawn-pi.ts does) so a U+2028/U+2029
// inside a JSON string never splits a line.
const splitLines = (onLine: (line: string) => void): ((chunk: Buffer) => void) => {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  return (chunk) => {
    buffer += decoder.write(chunk);
    let end = buffer.indexOf('\n');
    while (end !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/u, '');
      buffer = buffer.slice(end + 1);
      if (line.trim() !== '') onLine(line);
      end = buffer.indexOf('\n');
    }
  };
};

// The tail of a run's stderr, kept for the session-end reason a crash surfaces.
const stderrTail = (): { push: (chunk: Buffer) => void; text: () => string } => {
  const max = 2000;
  let text = '';
  return {
    push: (chunk) => {
      text = (text + chunk.toString()).slice(-max);
    },
    text: () => text.trim(),
  };
};

// One `opencode run` child. `sawStop` records that the run reached its terminal
// `step_finish{reason:"stop"}` (the whole turn completed); `interrupting` marks that this run was
// deliberately killed by `interrupt`/`close`/`kill`. Both are per-run so a later run cannot read a
// former run's flag.
interface Run {
  child: ChildProcess;
  exited: Promise<number | null>;
  sawStop: boolean;
  interrupting: boolean;
}

interface Ctx {
  options: SpawnOpencodeOptions;
  doSpawn: OpencodeSpawn;
  command: string;
  lineListeners: ((line: string) => void)[];
  exitListeners: ((code: number | null) => void)[];
  stderr: ReturnType<typeof stderrTail>;
  sessionId: string | null;
  run: Run | null;
  // Turns received while a run is active; started in order as each run completes cleanly.
  pending: string[];
  closed: boolean;
  exitFired: boolean;
}

const fireExit = (ctx: Ctx, code: number | null): void => {
  if (ctx.exitFired) return;
  ctx.exitFired = true;
  for (const listener of ctx.exitListeners) listener(code);
};

// Classify a run's exit, returning whether the wrapper should now start the next queued turn. An
// interrupted or closed run is expected (no queue drain); a run that never reached its terminal
// stop step crashed and is surfaced via `onExit`; a clean turn end is swallowed and the queue
// drains. `code`/`sawStop`/`interrupting` are all read off the run that just exited.
const onRunExit = (ctx: Ctx, run: Run, code: number | null): boolean => {
  if (run.interrupting) return false;
  if (ctx.closed) {
    fireExit(ctx, code);
    return false;
  }
  if (!run.sawStop) {
    fireExit(ctx, code);
    return false;
  }
  return true;
};

const startRun = (ctx: Ctx, text: string): void => {
  const child = ctx.doSpawn(ctx.command, runArgs(ctx.options, ctx.sessionId, text), {
    cwd: ctx.options.cwd,
    env: ctx.options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so interrupting or closing a run reaches the MCP server it spawned.
    detached: true,
  });
  const run: Run = { child, exited: Promise.resolve(null), sawStop: false, interrupting: false };
  child.stdout?.on(
    'data',
    splitLines((line) => {
      const parsed = parseOpencodeLine(line);
      if (parsed?.kind === 'step_start' && ctx.sessionId === null) ctx.sessionId = parsed.sessionId;
      if (parsed?.kind === 'step_finish' && parsed.reason === 'stop') run.sawStop = true;
      for (const listener of ctx.lineListeners) listener(line);
    }),
  );
  child.stderr?.on('data', ctx.stderr.push);
  child.on('error', () => {});
  run.exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      if (ctx.run === run) ctx.run = null;
      resolve(code);
      const next = onRunExit(ctx, run, code) ? ctx.pending.shift() : undefined;
      if (next !== undefined) startRun(ctx, next);
    });
  });
  ctx.run = run;
};

const closeRun = async (ctx: Ctx): Promise<number | null> => {
  ctx.closed = true;
  ctx.pending = [];
  if (ctx.run === null) {
    fireExit(ctx, null);
    return null;
  }
  const code = await closeChild(ctx.run.child, ctx.run.exited, ctx.options.close);
  fireExit(ctx, code);
  return code;
};

export const spawnOpencode = (options: SpawnOpencodeOptions): AgentProcess => {
  const ctx: Ctx = {
    options,
    doSpawn: options.spawn ?? nodeSpawn,
    command: options.command ?? 'opencode',
    lineListeners: [],
    exitListeners: [],
    stderr: stderrTail(),
    sessionId: options.resume ?? null,
    run: null,
    pending: [],
    closed: false,
    exitFired: false,
  };
  return {
    // opencode `run` takes the message as an argv positional; a fresh run per turn (ADR 0027). A
    // send while a run is active queues behind it rather than spawning a second `--session` child.
    // Attachments/images ride opencode's `-f` file paths, out of scope here (ADR 0027 Consequences).
    send: (text) => {
      if (ctx.closed) return;
      if (ctx.run === null) startRun(ctx, text);
      else ctx.pending.push(text);
    },
    // Ends the CURRENT run (SIGTERM→SIGKILL of its group, close-child.ts) and drops any queued
    // turns, without ending the wrapper: the swallowed exit keeps it alive for the next `send`.
    interrupt: () => {
      ctx.pending = [];
      if (ctx.run === null) return;
      ctx.run.interrupting = true;
      void closeChild(ctx.run.child, ctx.run.exited, options.close);
    },
    onLine: (listener) => {
      ctx.lineListeners.push(listener);
    },
    onExit: (listener) => {
      ctx.exitListeners.push(listener);
    },
    close: () => closeRun(ctx),
    kill: () => {
      ctx.closed = true;
      ctx.pending = [];
      if (ctx.run === null) fireExit(ctx, null);
      else killChildGroup(ctx.run.child);
    },
    stderr: ctx.stderr.text,
  };
};
