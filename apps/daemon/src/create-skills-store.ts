import type { Skill } from '@flux/protocol';
import { skillName } from '@flux/protocol';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DaemonError } from './daemon-error.ts';

// Box-side skills as raw files (prd.md P2, protocol.md § 7 `skills.*`): each skill is a
// `<name>/SKILL.md` under the flux user's `~/.claude/skills`. Flux only reads and writes these
// files; it never runs them. `list` reads every skill's `SKILL.md`; `write` creates or overwrites
// one, making its directory as needed; `remove` deletes the whole skill directory. A missing
// skills dir reads as an empty list, never an error.

export interface SkillsStore {
  list: () => Promise<Skill[]>;
  write: (name: string, body: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

const file = 'SKILL.md';

// Every path is `join(baseDir, safeName, 'SKILL.md')` and the name is re-validated with the same
// guard the wire uses, so a traversal attempt is `bad_params` and nothing is written outside
// `baseDir` even if a bad name reached here past the protocol guard.
const skillDir = (baseDir: string, name: string): string => {
  if (!skillName.is(name)) throw new DaemonError('bad_params', `unsafe skill name ${String(name)}`);
  return join(baseDir, name);
};

const readSkill = async (baseDir: string, name: string): Promise<Skill | null> => {
  try {
    return { name, body: await readFile(join(baseDir, name, file), 'utf8') };
  } catch {
    return null;
  }
};

// Directories that hold a readable `SKILL.md`, by name; a dir without one is not a skill.
const listSkills = async (baseDir: string): Promise<Skill[]> => {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const read = await Promise.all(names.map((name) => readSkill(baseDir, name)));
  return read
    .filter((s): s is Skill => s !== null)
    .toSorted((a, b) => a.name.localeCompare(b.name));
};

export const createSkillsStore = (baseDir: string): SkillsStore => ({
  list: () => listSkills(baseDir),
  write: async (name, body) => {
    const dir = skillDir(baseDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), body, 'utf8');
  },
  remove: async (name) => {
    await rm(skillDir(baseDir, name), { recursive: true, force: true });
  },
});
