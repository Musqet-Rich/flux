import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { createSettingsStore } from './create-settings-store.ts';
import { DaemonError } from './daemon-error.ts';
import { openDatabase } from './open-database.ts';

const defaults = {
  reposDir: '/home/flux/repos',
  defaultAgent: 'claude' as const,
  notifyOnAsk: true,
  notifyOnIdle: true,
  notifyOnDone: true,
};

test('returns the defaults until something is set, then the stored values survive a reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-repos-'));
  const db = openDatabase(':memory:');
  const store = createSettingsStore({ db, reposDir: defaults.reposDir });
  expect(store.get()).toEqual(defaults);
  expect(store.set({ notifyOnIdle: false, reposDir: dir })).toEqual({
    ...defaults,
    notifyOnIdle: false,
    reposDir: dir,
  });
  const reopened = createSettingsStore({ db, reposDir: '/elsewhere' });
  expect(reopened.get()).toEqual({ ...defaults, notifyOnIdle: false, reposDir: dir });
  expect(reopened.set({}).defaultAgent).toBe('claude');
});

test('reposDir is resolved and must be a directory; check refuses what set would', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-repos-'));
  const store = createSettingsStore({ db: openDatabase(':memory:'), reposDir: '/r' });
  expect(store.set({ reposDir: `${dir}/` }).reposDir).toBe(dir);
  expect(store.set({ reposDir: `${dir}/sub/..` }).reposDir).toBe(dir);
  expect(() => store.set({ reposDir: join(dir, 'missing') })).toThrow('not a directory');
  expect(() => {
    store.check({ reposDir: join(dir, 'missing') });
  }).toThrow(DaemonError);
  expect(() => {
    store.check({ reposDir: 'repos' });
  }).toThrow('absolute');
  store.check({ reposDir: dir, notifyOnAsk: false });
  expect(store.get().reposDir).toBe(dir);
});

test('refuses a relative repos directory and ignores an unreadable stored row', () => {
  const db = openDatabase(':memory:');
  const store = createSettingsStore({ db, reposDir: defaults.reposDir });
  expect(() => store.set({ reposDir: 'repos' })).toThrow(DaemonError);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('flux', ?)").run('not json');
  expect(store.get()).toEqual(defaults);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('flux', ?)").run('{"x":1}');
  expect(store.get()).toEqual(defaults);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('flux', ?)").run(
    '{"defaultAgent":"gpt"}',
  );
  expect(store.get()).toEqual(defaults);
});
