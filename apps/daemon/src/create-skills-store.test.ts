import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { createSkillsStore } from './create-skills-store.ts';
import { DaemonError } from './daemon-error.ts';

const tempBase = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), 'flux-skills-')), 'skills');

test('missing skills dir lists nothing rather than throwing', async () => {
  const store = createSkillsStore(await tempBase());
  expect(await store.list()).toEqual([]);
});

test('write then list round-trips, delete removes, dirs without SKILL.md are skipped', async () => {
  const base = await tempBase();
  const store = createSkillsStore(base);
  await store.write('review', '# Review\n');
  await store.write('deploy', 'steps');
  // A bare directory with no SKILL.md is not a skill and must not appear in the list.
  await mkdir(join(base, 'empty'), { recursive: true });
  expect(await store.list()).toEqual([
    { name: 'deploy', body: 'steps' },
    { name: 'review', body: '# Review\n' },
  ]);
  expect(await readFile(join(base, 'review', 'SKILL.md'), 'utf8')).toBe('# Review\n');
  await store.write('review', 'edited');
  expect(await store.list()).toContainEqual({ name: 'review', body: 'edited' });
  await store.remove('review');
  expect((await store.list()).map((s) => s.name)).toEqual(['deploy']);
  // Deleting a skill that is not there is a no-op, not an error.
  await store.remove('review');
});

test('a traversal or unsafe name is bad_params and writes nothing outside the base dir', async () => {
  const base = await tempBase();
  await mkdir(base, { recursive: true });
  // A canary next to the base dir that no traversal may reach.
  const outside = join(base, '..', 'canary.md');
  await writeFile(outside, 'original', 'utf8');
  const store = createSkillsStore(base);
  const bad = ['../evil', '/etc/x', 'a/b', '', '.', '..', 'a\\b'];
  await Promise.all(
    bad.map(async (name) => {
      await expect(store.write(name, 'pwned')).rejects.toThrow(DaemonError);
      await expect(store.remove(name)).rejects.toThrow(DaemonError);
    }),
  );
  // The canary one level up is untouched: no traversal reached it.
  expect(await readFile(outside, 'utf8')).toBe('original');
  // The base dir holds only what a valid write put there.
  await store.write('ok', 'body');
  expect((await readdir(base)).toSorted()).toEqual(['ok']);
});
