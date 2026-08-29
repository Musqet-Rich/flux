import type { AgentConfig } from '@flux/protocol';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DaemonError } from './daemon-error.ts';

// The agent's global config as raw files (prd.md P2): `CLAUDE.md` and `settings.json` in the
// flux user's `~/.claude`. Read gives the current text (empty when the file does not exist);
// write replaces whole files, and `settings.json` must parse as JSON so a typo cannot stop
// Claude Code from starting.

export interface AgentConfigFiles {
  read: () => Promise<AgentConfig>;
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

const isJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

export const createAgentConfig = (claudeDir: string): AgentConfigFiles => {
  const read = async (): Promise<AgentConfig> => ({
    claudeMd: await readOrEmpty(join(claudeDir, files.claudeMd)),
    settingsJson: await readOrEmpty(join(claudeDir, files.settingsJson)),
  });
  return {
    read,
    write: async (patch) => {
      if (patch.settingsJson !== undefined && !isJson(patch.settingsJson)) {
        throw new DaemonError('bad_params', 'settings.json is not valid JSON');
      }
      await mkdir(claudeDir, { recursive: true });
      await Promise.all(
        fields
          .filter((field) => patch[field] !== undefined)
          .map((field) => writeFile(join(claudeDir, files[field]), patch[field] ?? '', 'utf8')),
      );
      return read();
    },
  };
};
