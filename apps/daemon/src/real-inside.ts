import { realpath } from 'node:fs/promises';
import { basename, dirname, relative, sep } from 'node:path';

import { DaemonError } from './daemon-error.ts';
import { inside } from './inside.ts';

// `inside` for a path that will be read or written: the lexical check first, then the path is
// resolved through its symlinks and must still be under the worktree's real path. The file
// itself may not exist yet (a write creates it), but its directory must. `.git` is refused:
// editing the repository's own metadata from a phone can break the worktree or, via
// `core.hooksPath` and friends, run code on the box.

export interface RealPath {
  // The path as resolved lexically under the worktree; what the caller asked for.
  path: string;
  // Where the bytes actually live, symlinks resolved; the place to read or write.
  real: string;
}

const under = (root: string, path: string): boolean => path === root || path.startsWith(root + sep);

const codeOf = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';

const resolve = async (path: string): Promise<{ real: string | null; code: string }> => {
  try {
    return { real: await realpath(path), code: '' };
  } catch (error) {
    return { real: null, code: codeOf(error) };
  }
};

const escape = (root: string): DaemonError => new DaemonError('bad_params', `path escapes ${root}`);

// A file that does not exist yet resolves as its (existing) directory plus its name.
const resolveNew = async (root: string, full: string, code: string): Promise<string> => {
  if (code === 'ENOTDIR') throw new DaemonError('bad_params', `not a directory on the way`);
  const dir = await resolve(dirname(full));
  if (dir.real === null) throw new DaemonError('not_found', `no such directory for ${full}`);
  const real = dir.real + sep + basename(full);
  if (!under(root, real)) throw escape(root);
  return real;
};

export const realInside = async (root: string, path: string): Promise<RealPath> => {
  const full = inside(root, path);
  const first = relative(root, full).split(sep).at(0);
  if (first === '.git') throw new DaemonError('bad_params', 'the .git directory is off limits');
  const rootReal = (await resolve(root)).real;
  if (rootReal === null) throw new DaemonError('not_found', `no such worktree ${root}`);
  const file = await resolve(full);
  if (file.real !== null) {
    if (!under(rootReal, file.real)) throw escape(root);
    return { path: full, real: file.real };
  }
  return { path: full, real: await resolveNew(rootReal, full, file.code) };
};
