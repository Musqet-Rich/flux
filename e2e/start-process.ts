import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { E2eError } from './e2e-error.ts';

// A long-running child (relay, daemon) that is ready once a stdout line matches `ready`. The
// match is returned so the caller can read a port or a URL out of it; stderr is echoed under
// a prefix so a failing run shows what the child said.

export interface ProcessOptions {
  name: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  ready: RegExp;
}

export interface StartedProcess {
  match: RegExpExecArray;
  stop: () => Promise<void>;
}

const untilExit = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });

const untilReady = (child: ChildProcess, options: ProcessOptions): Promise<RegExpExecArray> =>
  new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout ?? process.stdin });
    lines.on('line', (line) => {
      const match = options.ready.exec(line);
      if (match !== null) resolve(match);
    });
    child.once('exit', (code) => {
      reject(new E2eError(`${options.name} exited with ${code} before it was ready`));
    });
    child.once('error', (error) => {
      reject(new E2eError(`${options.name} could not start: ${error.message}`));
    });
  });

export const startProcess = async (options: ProcessOptions): Promise<StartedProcess> => {
  const child = spawn(options.command, options.args, {
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    process.stderr.write(`[${options.name}] ${chunk}`);
  });
  const exited = untilExit(child);
  const match = await untilReady(child, options);
  return {
    match,
    stop: () => {
      child.kill('SIGTERM');
      return exited;
    },
  };
};
