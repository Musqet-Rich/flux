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

test('returns the defaults until something is set, then the stored values survive a reopen', () => {
  const db = openDatabase(':memory:');
  const store = createSettingsStore({ db, defaults });
  expect(store.get()).toEqual(defaults);
  expect(store.set({ notifyOnIdle: false, reposDir: '/srv/repos' })).toEqual({
    ...defaults,
    notifyOnIdle: false,
    reposDir: '/srv/repos',
  });
  const reopened = createSettingsStore({ db, defaults: { ...defaults, defaultAgent: 'pi' } });
  expect(reopened.get()).toEqual({ ...defaults, notifyOnIdle: false, reposDir: '/srv/repos' });
  expect(reopened.set({}).defaultAgent).toBe('claude');
});

test('refuses a relative repos directory and ignores an unreadable stored row', () => {
  const db = openDatabase(':memory:');
  const store = createSettingsStore({ db, defaults });
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
