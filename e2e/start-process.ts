import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { E2eError } from './e2e-error.ts';

// A long-running child (relay, daemon) that is ready once a stdout line matches `ready`. The
// match is returned so the caller can read a port or a URL out of it; stderr is echoed under
// a prefix so a failing run shows what the child said. Each child leads its own process
// group, so stopping it also stops what it spawned (the daemon's agent shim and the fake).

export interface ProcessOptions {
  name: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  ready: RegExp;
}

export interface StartedProcess {
  match: RegExpExecArray;
  // SIGTERM to the group, SIGKILL if it is still there after `killAfterMs`.
  stop: () => Promise<void>;
  // For an `exit` handler: SIGKILL the group now, nothing awaited.
  killNow: () => void;
}

const killAfterMs = 3000;

const signalGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone; nothing to stop.
  }
};

const untilExit = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });

const untilReady = (child: ChildProcess, options: ProcessOptions): Promise<RegExpExecArray> =>
  new Promise((resolve, reject) => {
    const { stdout } = child;
    if (stdout === null) {
      reject(new E2eError(`${options.name} has no stdout`));
      return;
    }
    const early = (code: number | null): void => {
      reject(new E2eError(`${options.name} exited with ${code} before it was ready`));
    };
    child.once('exit', early);
    child.once('error', (error) => {
      reject(new E2eError(`${options.name} could not start: ${error.message}`));
    });
    createInterface({ input: stdout }).on('line', (line) => {
      const match = options.ready.exec(line);
      if (match === null) return;
      child.off('exit', early);
      child.once('exit', (code) => {
        process.stderr.write(`[${options.name}] exited with ${code}\n`);
      });
      resolve(match);
    });
  });

export const startProcess = async (options: ProcessOptions): Promise<StartedProcess> => {
  const child = spawn(options.command, options.args, {
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    process.stderr.write(`[${options.name}] ${chunk}`);
  });
  const exited = untilExit(child);
  const match = await untilReady(child, options);
  return {
    match,
    stop: async () => {
      signalGroup(child, 'SIGTERM');
      const killer = setTimeout(() => {
        signalGroup(child, 'SIGKILL');
      }, killAfterMs);
      await exited;
      clearTimeout(killer);
    },
    killNow: () => {
      signalGroup(child, 'SIGKILL');
    },
  };
};
