import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import { DaemonError } from '../daemon-error.ts';
import type { CommandResult, ServiceIo } from './service-io.ts';

// The real side effects behind `ServiceIo`: the filesystem and `systemctl`/`launchctl`, spawned
// with an argument vector (never a shell string). `run` resolves with the exit code so a probe's
// non-zero exit is data; only a missing binary (ENOENT) rejects, as a DaemonError.

const run = (argv: readonly string[]): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    if (command === undefined) {
      reject(new DaemonError('internal', 'no command given'));
      return;
    }
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err.push(chunk);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      const missing = error.code === 'ENOENT';
      reject(new DaemonError('internal', missing ? `${command} not found on PATH` : error.message));
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });

export const realServiceIo: ServiceIo = {
  exists: (path) => existsSync(path),
  writeFile: (path, content, mode) => writeFile(path, content, { mode }),
  removeFile: (path) => rm(path, { force: true }),
  mkdirp: async (path) => {
    await mkdir(path, { recursive: true });
  },
  run,
};
