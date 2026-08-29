import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Write side of the Claude adapter, StreamJsonInput (ADR 0007): one long-lived headless process
// per session, user turns written as JSON lines to stdin, output read as JSON lines. The
// command is injectable so tests drive a fixture-replaying fake instead of the real binary.

export interface AgentProcess {
  send: (text: string) => void;
  onLine: (listener: (line: string) => void) => void;
  onExit: (listener: (code: number | null) => void) => void;
  close: () => Promise<number | null>;
  kill: () => void;
}

export interface SpawnClaudeOptions {
  cwd: string;
  command?: string;
  resume?: string;
  mcpConfig?: string;
  env?: NodeJS.ProcessEnv;
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

export const spawnClaude = (options: SpawnClaudeOptions): AgentProcess => {
  const args = [
    ...baseArgs,
    ...(options.resume === undefined ? [] : ['--resume', options.resume]),
    ...(options.mcpConfig === undefined
      ? []
      : ['--mcp-config', options.mcpConfig, '--append-system-prompt', fluxPrompt]),
  ];
  const child = spawn(options.command ?? 'claude', args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'ignore'],
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
    onLine: (listener) => {
      lineListeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    close: () => {
      child.stdin.end();
      return exited;
    },
    kill: () => {
      child.kill('SIGTERM');
    },
  };
};
