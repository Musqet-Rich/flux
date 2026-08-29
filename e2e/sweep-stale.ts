import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Leftovers of an earlier run this process did not get to clean up (a killed worker, a lost
// terminal): every `flux-e2e-*` dir under the temp root older than `staleAfterMs`, its process
// groups killed by the pidfiles start-stack.ts wrote, then removed. Younger dirs are presumed
// to belong to a run still going, possibly in another checkout on the same machine.

const staleAfterMs = 10 * 60 * 1000;

const killGroups = (dir: string): void => {
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.pid'))) {
    const pid = Number(readFileSync(join(dir, name), 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 1) continue;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
};

const ageOf = (dir: string): number | null => {
  try {
    return Date.now() - statSync(dir).mtimeMs;
  } catch {
    return null;
  }
};

export const sweepStale = (): string[] => {
  const root = tmpdir();
  const swept: string[] = [];
  for (const name of readdirSync(root)) {
    if (!name.startsWith('flux-e2e-')) continue;
    const dir = join(root, name);
    const age = ageOf(dir);
    if (age === null || age < staleAfterMs) continue;
    killGroups(dir);
    rmSync(dir, { recursive: true, force: true });
    swept.push(dir);
  }
  return swept;
};
