import type { ChildProcess } from 'node:child_process';

// Ends an agent process within a bound (ADR 0017). Three stages, each given `graceMs` before
// the next: stdin EOF (the agent's own clean exit), SIGTERM, then SIGKILL on the whole process
// group so the MCP server or extension the agent spawned dies with it. An agent blocked inside
// a flux_ask that will never be answered ignores the first two; without the third, the
// daemon's shutdown hung forever and the operator's restart left two daemons on one data dir.

export interface CloseChildOptions {
  graceMs?: number;
  // Called with the name of each stage taken, for the daemon's stderr.
  log?: (stage: string) => void;
}

const defaultGraceMs = 1500;

// Resolves when the process has exited or `ms` have passed, whichever is first, and leaves no
// timer behind either way.
const exitedWithin = (exited: Promise<number | null>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void exited.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });

// The agent is spawned as a group leader, so a negative pid reaches its children too; a
// process that is already gone raises ESRCH, which is the outcome wanted.
const signal = (child: ChildProcess, name: 'SIGTERM' | 'SIGKILL', group: boolean): void => {
  try {
    if (group && child.pid !== undefined) process.kill(-child.pid, name);
    else child.kill(name);
  } catch {
    // Already gone.
  }
};

export const closeChild = async (
  child: ChildProcess,
  exited: Promise<number | null>,
  options: CloseChildOptions = {},
): Promise<number | null> => {
  const graceMs = options.graceMs ?? defaultGraceMs;
  const log = options.log ?? ((): void => {});
  let gone = false;
  void exited.finally(() => {
    gone = true;
  });
  // Let an already-settled exit mark `gone` before the first stage, so closing a process that
  // has already left takes no stage.
  await Promise.resolve();
  const stage = async (name: string, act: () => void): Promise<void> => {
    if (gone) return;
    log(name);
    act();
    await exitedWithin(exited, graceMs);
  };
  await stage('stdin closed', () => {
    child.stdin?.end();
  });
  await stage('SIGTERM', () => {
    signal(child, 'SIGTERM', false);
  });
  await stage('SIGKILL', () => {
    signal(child, 'SIGKILL', true);
  });
  return gone ? exited : null;
};
