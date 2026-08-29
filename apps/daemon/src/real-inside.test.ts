import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';

import { realInside } from './real-inside.ts';

// A worktree whose own path goes through a symlink (as /tmp does on macOS), holding a plain
// file, a subdirectory, a .git directory, a symlink to a file outside, a symlink to a
// directory outside, and a symlink to a file inside.

let root: string;
let target: string;
let worktree: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'flux-real-'));
  target = join(root, 'target');
  await mkdir(join(target, 'src'), { recursive: true });
  await mkdir(join(target, '.git'));
  await writeFile(join(target, '.git', 'config'), '');
  await writeFile(join(target, 'a.txt'), 'a');
  await writeFile(join(root, 'outside.txt'), 'o');
  await symlink(join(root, 'outside.txt'), join(target, 'escape.txt'));
  await symlink(root, join(target, 'up'));
  await symlink(join(target, 'a.txt'), join(target, 'alias.txt'));
  await symlink(target, join(root, 'link'));
  worktree = join(root, 'link');
});

test('resolves existing files, new files in existing directories, and the root itself', async () => {
  const real = await realpath(target);
  expect(await realInside(worktree, 'a.txt')).toEqual({
    path: join(worktree, 'a.txt'),
    real: join(real, 'a.txt'),
  });
  expect(await realInside(worktree, 'src/new.ts')).toEqual({
    path: join(worktree, 'src/new.ts'),
    real: join(real, 'src/new.ts'),
  });
  expect(await realInside(worktree, '.')).toEqual({ path: worktree, real });
  expect((await realInside(real, 'a.txt')).real).toBe(join(real, 'a.txt'));
});

test('an in-worktree symlink resolves to its target, which is where a write goes', async () => {
  const real = await realpath(target);
  expect((await realInside(worktree, 'alias.txt')).real).toBe(join(real, 'a.txt'));
  // Out and back in again still lands inside, and that is what counts.
  expect((await realInside(worktree, 'up/target/a.txt')).real).toBe(join(real, 'a.txt'));
});

test('refuses lexical escapes before touching the disk', async () => {
  await expect(realInside(worktree, '../outside.txt')).rejects.toMatchObject({
    code: 'bad_params',
  });
  await expect(realInside(worktree, '/etc/passwd')).rejects.toMatchObject({ code: 'bad_params' });
});

test('refuses a symlinked file or directory that leaves the worktree', async () => {
  await expect(realInside(worktree, 'escape.txt')).rejects.toMatchObject({ code: 'bad_params' });
  await expect(realInside(worktree, 'up/outside.txt')).rejects.toMatchObject({
    code: 'bad_params',
  });
  await expect(realInside(worktree, 'up/new.txt')).rejects.toMatchObject({ code: 'bad_params' });
});

test('refuses anything under .git', async () => {
  await expect(realInside(worktree, '.git')).rejects.toMatchObject({ code: 'bad_params' });
  await expect(realInside(worktree, '.git/config')).rejects.toMatchObject({ code: 'bad_params' });
  await expect(realInside(worktree, 'src/../.git/hooks')).rejects.toMatchObject({
    code: 'bad_params',
  });
  expect((await realInside(worktree, '.gitignore')).path).toBe(join(worktree, '.gitignore'));
});

test('a missing directory is not_found; a file in the way is bad_params', async () => {
  await expect(realInside(worktree, 'nope/new.ts')).rejects.toMatchObject({ code: 'not_found' });
  await expect(realInside(join(root, 'gone'), 'a.txt')).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(realInside(worktree, 'a.txt/x')).rejects.toMatchObject({ code: 'bad_params' });
});
