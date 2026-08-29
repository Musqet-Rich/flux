import type { AgentConfig } from '@flux/protocol';
import { guards } from '@flux/protocol';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DaemonError } from './daemon-error.ts';

// The agent's global config as raw files (prd.md P2): `CLAUDE.md` and `settings.json` in the
// flux user's `~/.claude`. Read gives the current text (empty when the file does not exist);
// write replaces whole files, and `settings.json` must be a JSON object so a typo cannot stop
// Claude Code from starting.

export interface AgentConfigFiles {
  read: () => Promise<AgentConfig>;
  // Throws bad_params for a patch `write` would refuse; callers check before touching anything.
  check: (patch: Partial<AgentConfig>) => void;
  write: (patch: Partial<AgentConfig>) => Promise<AgentConfig>;
}

const files = { claudeMd: 'CLAUDE.md', settingsJson: 'settings.json' } as const;
const fields = ['claudeMd', 'settingsJson'] as const;

const readOrEmpty = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
};

// Claude Code reads settings.json as an object; `null`, `[]` or `"x"` parse but break it.
const isJsonObject = (text: string): boolean => {
  try {
    return guards.isRecord(JSON.parse(text));
  } catch {
    return false;
  }
};

const check = (patch: Partial<AgentConfig>): void => {
  if (patch.settingsJson !== undefined && !isJsonObject(patch.settingsJson)) {
    throw new DaemonError('bad_params', 'settings.json must be a JSON object');
  }
};

// Whole-file replace through a sibling temp file and rename, so a crash mid-write cannot leave
// a half-written config, keeping the mode of the file it replaces. A symlinked file is
// replaced by a regular file (ADR 0015).
const replaceFile = async (path: string, text: string): Promise<void> => {
  const mode = await stat(path).then(
    (s) => s.mode & 0o777,
    () => 0o600,
  );
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, text, { encoding: 'utf8', mode });
  await rename(temp, path);
};

export const createAgentConfig = (claudeDir: string): AgentConfigFiles => {
  const read = async (): Promise<AgentConfig> => ({
    claudeMd: await readOrEmpty(join(claudeDir, files.claudeMd)),
    settingsJson: await readOrEmpty(join(claudeDir, files.settingsJson)),
  });
  return {
    read,
    check,
    write: async (patch) => {
      check(patch);
      await mkdir(claudeDir, { recursive: true });
      // One file at a time, so a failure on the second leaves the first complete, not torn.
      await fields
        .filter((field) => patch[field] !== undefined)
        .reduce(
          (previous, field) =>
            previous.then(() => replaceFile(join(claudeDir, files[field]), patch[field] ?? '')),
          Promise.resolve(),
        );
      return read();
    },
  };
};
