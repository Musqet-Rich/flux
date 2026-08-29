import { guards } from '@flux/protocol';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import type { AgentProcess } from '../claude/spawn-claude.ts';
import type { CloseChildOptions } from '../close-child.ts';
import { closeChild } from '../close-child.ts';

const { isRecord, isString, isOneOf } = guards;

// Write side of the pi adapter (ADR 0016): one long-lived `pi --mode rpc` process per session,
// prompts written as JSON commands to stdin, events read as JSON lines from stdout. The Flux
// session id doubles as pi's session id (`--session-id` creates or resumes), so a restart
// resumes with the same arguments and nothing is stored beyond what Flux already has.

export interface SpawnPiOptions {
  cwd: string;
  session: string;
  sessionDir: string;
  command?: string;
  extension?: string;
  provider?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  close?: CloseChildOptions;
}

// Goes with the Flux tools (ADR 0008): the agent has no interactive prompt in headless mode, so
// it is told how to reach the operator instead of guessing or stalling.
const fluxPrompt =
  'You are running unattended under Flux. The operator is on a phone. For any material decision ' +
  '(design choices, destructive actions, ambiguous requirements) call flux_ask instead of guessing; ' +
  'call flux_notify with level "done" when the task is complete and "blocked" when you cannot proceed.';

const piArgs = (options: SpawnPiOptions): string[] => [
  '--mode',
  'rpc',
  '--session-dir',
  options.sessionDir,
  '--session-id',
  options.session,
  // Project-local pi files (extensions, prompts) would need a trust prompt nobody can answer,
  // and the operator's own extensions, skills and prompt templates are not loaded either: an
  // extension that opens a dialog would stall the run, and a run should not depend on what is
  // in ~/.pi. Context files (AGENTS.md, CLAUDE.md) still load; the Flux extension is explicit.
  '--no-approve',
  '--no-extensions',
  '--no-skills',
  '--no-prompt-templates',
  ...(options.provider === undefined ? [] : ['--provider', options.provider]),
  ...(options.model === undefined ? [] : ['--model', options.model]),
  ...(options.extension === undefined
    ? []
    : ['--extension', options.extension, '--append-system-prompt', fluxPrompt]),
];

// pi's RPC framing is LF-only JSONL; `node:readline` also splits on U+2028/U+2029, which are
// legal inside JSON strings, so lines are split by hand (pi's rpc.md says the same).
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

// Should a dialog request slip through anyway (a context-file hook, a future pi), it is
// cancelled at once rather than left blocking the run; the operator sees it as a `raw` notice.
const dialogMethods = ['select', 'confirm', 'input', 'editor'];

const dialogId = (line: string): string | null => {
  if (!line.includes('"extension_ui_request"')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['type'] !== 'extension_ui_request') return null;
  return isString(parsed['id']) && isOneOf(parsed['method'], dialogMethods) ? parsed['id'] : null;
};

// The last of pi's stderr, for the `ended` reason: an auth or model failure prints there.
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

interface Wired {
  lineListeners: ((line: string) => void)[];
  exitListeners: ((code: number | null) => void)[];
  exited: Promise<number | null>;
}

const wire = (child: ChildProcessWithoutNullStreams, command: Command): Wired => {
  const lineListeners: Wired['lineListeners'] = [];
  const exitListeners: Wired['exitListeners'] = [];
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      for (const listener of exitListeners) listener(code);
      resolve(code);
    });
  });
  // An EPIPE on stdin after pi died is reported through `exit`, not as a crash here.
  child.stdin.on('error', () => {});
  child.on('error', () => {});
  child.stdout.on(
    'data',
    splitLines((line) => {
      const id = dialogId(line);
      if (id !== null) command({ type: 'extension_ui_response', id, cancelled: true });
      for (const listener of lineListeners) listener(line);
    }),
  );
  return { lineListeners, exitListeners, exited };
};

type Command = (message: Record<string, unknown>) => void;

export const spawnPi = (options: SpawnPiOptions): AgentProcess => {
  const child = spawn(options.command ?? 'pi', piArgs(options), {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Its own process group, so closing it can reach anything it spawned.
    detached: true,
  });
  const stderr = stderrTail();
  child.stderr.on('data', stderr.push);
  const command: Command = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const { lineListeners, exitListeners, exited } = wire(child, command);

  return {
    // `followUp` only matters while pi is streaming (the message waits for the run to finish);
    // idle, the prompt starts a run at once. Always sent so a second message never errors.
    send: (text) => {
      command({ type: 'prompt', message: text, streamingBehavior: 'followUp' });
    },
    interrupt: () => {
      command({ type: 'abort' });
    },
    onLine: (listener) => {
      lineListeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    close: () => closeChild(child, exited, options.close),
    kill: () => {
      child.kill('SIGTERM');
    },
    stderr: stderr.text,
  };
};
