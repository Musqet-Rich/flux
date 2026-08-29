import type { ChildProcess } from 'node:child_process';

// The fast path for a shutdown that cannot wait for close-child.ts (a second signal, the budget
// spent): SIGKILL the agent's whole process group now, nothing awaited, so nothing is left
// running under no daemon. The agent is spawned as a group leader, so the negative pid reaches
// the MCP server or extension it spawned; a group already gone raises ESRCH, the outcome wanted.
export const killChildGroup = (child: ChildProcess): void => {
  try {
    if (child.pid === undefined) child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
};
