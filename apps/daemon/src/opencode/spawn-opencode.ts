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
// opencode session id, forwards that run's NDJSON via `onLine`, and — critically — does NOT fire
// `onExit` when a run completes at a turn boundary (a finished run means "turn done", which the
// supervisor already learns from the mapped `turn.ended`). `onExit` fires only on `close`/`kill`,
// or on an abnormal run failure (a non-zero exit with no `step_finish`, i.e. a crash).

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

interface Ctx {
  options: SpawnOpencodeOptions;
  doSpawn: OpencodeSpawn;
  command: string;
  lineListeners: ((line: string) => void)[];
  exitListeners: ((code: number | null) => void)[];
  stderr: ReturnType<typeof stderrTail>;
  sessionId: string | null;
  run: { child: ChildProcess; exited: Promise<number | null> } | null;
  closed: boolean;
  interrupting: boolean;
  exitFired: boolean;
}

const fireExit = (ctx: Ctx, code: number | null): void => {
  if (ctx.exitFired) return;
  ctx.exitFired = true;
  for (const listener of ctx.exitListeners) listener(code);
};

// A run exit at a turn boundary is swallowed; only a crash or a close/kill reaches `onExit`.
const onRunExit = (ctx: Ctx, code: number | null, sawStepFinish: boolean): void => {
  if (ctx.interrupting) {
    ctx.interrupting = false;
    return;
  }
  if (ctx.closed) {
    fireExit(ctx, code);
    return;
  }
  if (code !== 0 && !sawStepFinish) fireExit(ctx, code);
};

const onData = (ctx: Ctx, sawStepFinish: { value: boolean }) =>
  splitLines((line) => {
    const parsed = parseOpencodeLine(line);
    if (parsed?.kind === 'step_start' && ctx.sessionId === null) ctx.sessionId = parsed.sessionId;
    if (parsed?.kind === 'step_finish') sawStepFinish.value = true;
    for (const listener of ctx.lineListeners) listener(line);
  });

const startRun = (ctx: Ctx, text: string): void => {
  const child = ctx.doSpawn(ctx.command, runArgs(ctx.options, ctx.sessionId, text), {
    cwd: ctx.options.cwd,
    env: ctx.options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so interrupting or closing a run reaches the MCP server it spawned.
    detached: true,
  });
  const sawStepFinish = { value: false };
  child.stdout?.on('data', onData(ctx, sawStepFinish));
  child.stderr?.on('data', ctx.stderr.push);
  child.on('error', () => {});
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      if (ctx.run?.child === child) ctx.run = null;
      resolve(code);
      onRunExit(ctx, code, sawStepFinish.value);
    });
  });
  ctx.run = { child, exited };
};

const closeRun = async (ctx: Ctx): Promise<number | null> => {
  ctx.closed = true;
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
    closed: false,
    interrupting: false,
    exitFired: false,
  };
  return {
    // opencode `run` takes the message as an argv positional; a fresh run per turn (ADR 0027).
    // Attachments/images ride opencode's `-f` file paths, out of scope here (ADR 0027 Consequences).
    send: (text) => {
      if (!ctx.closed) startRun(ctx, text);
    },
    // Ends the CURRENT run (SIGTERM→SIGKILL of its group, close-child.ts) without ending the
    // wrapper: the swallowed exit keeps it alive for the next turn.
    interrupt: () => {
      if (ctx.run === null) return;
      ctx.interrupting = true;
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
      if (ctx.run === null) fireExit(ctx, null);
      else killChildGroup(ctx.run.child);
    },
    stderr: ctx.stderr.text,
  };
};
