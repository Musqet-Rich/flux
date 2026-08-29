import type { RpcErrorCode } from '@flux/protocol';
import { spawn } from 'node:child_process';

import { DaemonError } from './daemon-error.ts';

// Runs one external command with an argument vector, never a shell string, and turns any failure
// into a DaemonError carrying what the command said. The git and gh services are built on this.

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  // Error code for a non-zero exit, a missing binary or a timeout.
  code: RpcErrorCode;
  timeoutMs?: number;
}

const maxBuffer = 64 * 1024 * 1024;
const defaultTimeoutMs = 120_000;

// The command runs as its own process group (`spawn` with `detached`; `execFile` ignores it) so
// a timeout kills what it spawned too (a commit hook, a credential helper), not just the leader,
// which would leave orphans holding the index.
const killGroup = (pid: number | undefined): void => {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
};

// What the failure was, in this order: git reports "nothing to commit" on stdout, so stdout is
// the fallback before the exit status.
const failure = (
  command: string,
  exit: { code: number | null; signal: NodeJS.Signals | null },
  stderr: string,
  stdout: string,
): string =>
  stderr.trim() || stdout.trim() || `${command} exited with ${exit.signal ?? exit.code ?? '?'}`;

export const runCommand = (command: string, args: string[], options: RunOptions): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let settled = false;
    let timedOut = false;
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new DaemonError(options.code, message));
    };
    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
      size += chunk.length;
      if (size > maxBuffer) {
        killGroup(child.pid);
        fail(`${command} produced more than ${maxBuffer} bytes`);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err.push(chunk);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      fail(error.code === 'ENOENT' ? `${command} not found on PATH` : error.message);
    });
    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(out).toString('utf8');
      if (timedOut) fail(`${command} timed out`);
      else if (code !== 0)
        fail(failure(command, { code, signal }, Buffer.concat(err).toString('utf8'), stdout));
      else if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(stdout);
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, options.timeoutMs ?? defaultTimeoutMs);
  });
