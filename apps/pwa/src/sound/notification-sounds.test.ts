import { expect, test } from 'vitest';

import { notificationSounds } from './notification-sounds.ts';

const { names, isName, catalogue, options } = notificationSounds;

test('every sound is a short run of audible notes at a modest level', () => {
  for (const sound of Object.values(catalogue)) {
    expect(sound.notes.length).toBeGreaterThan(0);
    for (const note of sound.notes) {
      expect(note.at).toBeGreaterThanOrEqual(0);
      expect(note.duration).toBeGreaterThan(0);
      expect(note.at + note.duration).toBeLessThanOrEqual(1);
      expect(note.frequency).toBeGreaterThanOrEqual(200);
      expect(note.frequency).toBeLessThanOrEqual(4000);
      expect(note.gain).toBeGreaterThan(0);
      expect(note.gain).toBeLessThanOrEqual(0.3);
    }
  }
});

test('the picker lists None first and then every sound by label', () => {
  expect(options.map((o) => o.name)).toEqual(names);
  expect(options[0]).toEqual({ name: 'none', label: 'None' });
  expect(options.slice(1).map((o) => o.label)).toEqual(['Chime', 'Ping', 'Marimba', 'Pulse']);
});

test('isName accepts the catalogue and nothing else', () => {
  for (const name of names) expect(isName(name)).toBe(true);
  expect(isName('bell')).toBe(false);
  expect(isName(null)).toBe(false);
  expect(isName({ name: 'chime' })).toBe(false);
});
