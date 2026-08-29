import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { CloseChildOptions } from '../close-child.ts';
import { closeChild } from '../close-child.ts';

// Write side of the Claude adapter, StreamJsonInput (ADR 0007): one long-lived headless process
// per session, user turns written as JSON lines to stdin, output read as JSON lines. The
// command is injectable so tests drive a fixture-replaying fake instead of the real binary.

export interface AgentProcess {
  send: (text: string) => void;
  // Stops the current run. Claude has no in-band abort, so this ends the process; pi keeps it.
  interrupt: () => void;
  onLine: (listener: (line: string) => void) => void;
  onExit: (listener: (code: number | null) => void) => void;
  // Bounded (close-child.ts): stdin EOF, then SIGTERM, then SIGKILL of the process group.
  close: () => Promise<number | null>;
  kill: () => void;
  // The tail of what the agent wrote to stderr, for the reason a session ended.
  stderr: () => string;
}

export interface SpawnClaudeOptions {
  cwd: string;
  command?: string;
  resume?: string;
  mcpConfig?: string;
  env?: NodeJS.ProcessEnv;
  close?: CloseChildOptions;
}

const baseArgs = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--dangerously-skip-permissions',
];

// Goes with the Flux tools (ADR 0008): the agent has no interactive prompt in headless mode, so
// it is told how to reach the operator instead of guessing or stalling.
const fluxPrompt =
  'You are running unattended under Flux. The operator is on a phone. For any material decision ' +
  '(design choices, destructive actions, ambiguous requirements) call flux_ask instead of guessing; ' +
  'call flux_notify with level "done" when the task is complete and "blocked" when you cannot proceed.';

const claudeArgs = (options: SpawnClaudeOptions): string[] => [
  ...baseArgs,
  ...(options.resume === undefined ? [] : ['--resume', options.resume]),
  ...(options.mcpConfig === undefined
    ? []
    : ['--mcp-config', options.mcpConfig, '--append-system-prompt', fluxPrompt]),
];

export const spawnClaude = (options: SpawnClaudeOptions): AgentProcess => {
  const child = spawn(options.command ?? 'claude', claudeArgs(options), {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'ignore'],
    // Its own process group, so closing it can reach the MCP server it spawned.
    detached: true,
  });
  const lineListeners: ((line: string) => void)[] = [];
  const exitListeners: ((code: number | null) => void)[] = [];
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      for (const listener of exitListeners) listener(code);
      resolve(code);
    });
  });
  // An EPIPE on stdin after the agent died is reported through `exit`, not as a crash here.
  child.stdin.on('error', () => {});
  child.on('error', () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (line.trim() === '') return;
    for (const listener of lineListeners) listener(line);
  });

  return {
    send: (text) => {
      const message = { type: 'user', message: { role: 'user', content: text } };
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    interrupt: () => {
      child.kill('SIGTERM');
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
    // Claude's stderr is not captured (ADR 0007): its failures arrive as `result` lines.
    stderr: () => '',
  };
};
