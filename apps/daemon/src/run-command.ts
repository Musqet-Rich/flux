import type { RpcErrorCode } from '@flux/protocol';
import type { ExecException } from 'node:child_process';
import { execFile } from 'node:child_process';

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

const describe = (command: string, error: ExecException, stderr: string, stdout: string) => {
  if (error.code === 'ENOENT') return `${command} not found on PATH`;
  if (error.killed === true) return `${command} timed out`;
  // git reports "nothing to commit" on stdout, so stdout is the fallback before the exit code.
  return stderr.trim() || stdout.trim() || error.message;
};

export const runCommand = (command: string, args: string[], options: RunOptions): Promise<string> =>
  new Promise((resolve, reject) => {
    const execOptions = {
      cwd: options.cwd,
      env: options.env,
      maxBuffer,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? defaultTimeoutMs,
    } as const;
    execFile(command, args, execOptions, (error, stdout, stderr) => {
      if (error) reject(new DaemonError(options.code, describe(command, error, stderr, stdout)));
      else resolve(stdout);
    });
  });
