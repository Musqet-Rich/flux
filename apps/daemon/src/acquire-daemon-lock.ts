import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { DaemonError } from './daemon-error.ts';

// One daemon per data directory (ADR 0017). `<dataDir>/daemon.lock` holds the pid of the daemon
// that owns the directory; a second `flux daemon` on the same directory refuses to start while
// that pid is alive, and replaces the file when it is not (a crash, a SIGKILL). Taken before
// the control socket is bound, because binding unlinks whatever socket file is there.

export interface DaemonLock {
  path: string;
  release: () => void;
}

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

// Signal 0 checks existence; EPERM means it exists under another user, which is alive enough.
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
};

const holder = (path: string): number | null => {
  try {
    const pid = Number(readFileSync(path, 'utf8'));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

// `wx` is create-exclusive: of two daemons racing for a stale lock, exactly one gets the file.
const create = (path: string): boolean => {
  try {
    const fd = openSync(path, 'wx');
    writeSync(fd, `${process.pid}\n`);
    closeSync(fd);
    return true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false;
    throw error;
  }
};

const remove = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
};

export const acquireDaemonLock = (dataDir: string): DaemonLock => {
  const path = join(dataDir, 'daemon.lock');
  if (!create(path)) {
    const pid = holder(path);
    if (pid !== null && alive(pid)) {
      throw new DaemonError('conflict', `another flux daemon (pid ${pid}) holds ${path}`);
    }
    remove(path);
    if (!create(path)) throw new DaemonError('conflict', `another flux daemon just took ${path}`);
  }
  return {
    path,
    release: () => {
      remove(path);
    },
  };
};
