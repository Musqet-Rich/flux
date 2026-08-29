import { realpath } from 'node:fs/promises';
import { basename, dirname, relative, sep } from 'node:path';

import { DaemonError } from './daemon-error.ts';
import { inside } from './inside.ts';

// `inside` for a path that will be read or written: the lexical check first, then the path is
// resolved through its symlinks and must still be under the worktree's real path. The file
// itself may not exist yet (a write creates it), but its directory must. A `.git` segment at
// any depth (a submodule's too) is refused, on the path as given and again on the resolved
// one, since a case-insensitive filesystem lets `.GIT` reach the real thing: editing the
// repository's own metadata from a phone can break the worktree or, via `core.hooksPath` and
// friends, run code on the box.

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

const touchesGit = (root: string, path: string): boolean =>
  relative(root, path)
    .split(sep)
    .some((segment) => segment.toLowerCase() === '.git');

const offLimits = (): DaemonError =>
  new DaemonError('bad_params', 'the .git directory is off limits');

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
  if (touchesGit(root, full)) throw offLimits();
  const rootReal = (await resolve(root)).real;
  if (rootReal === null) throw new DaemonError('not_found', `no such worktree ${root}`);
  const file = await resolve(full);
  const real = file.real ?? (await resolveNew(rootReal, full, file.code));
  if (!under(rootReal, real)) throw escape(root);
  if (touchesGit(rootReal, real)) throw offLimits();
  return { path: full, real };
};
