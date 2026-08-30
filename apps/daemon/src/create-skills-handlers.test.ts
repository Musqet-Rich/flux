import type { Skill } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { Peer } from './create-device-channels.ts';
import { createSkillsHandlers } from './create-skills-handlers.ts';
import type { SkillsStore } from './create-skills-store.ts';
import type { HandlerContext } from './handler-context.ts';

const peer = {} as unknown as Peer;

interface Fixture {
  skills: SkillsStore;
  calls: string[];
}

const fixture = (list: Skill[]): Fixture => {
  const calls: string[] = [];
  const skills: SkillsStore = {
    list: () => {
      calls.push('list');
      return Promise.resolve(list);
    },
    write: (name, body) => {
      calls.push(`write:${name}:${body}`);
      return Promise.resolve();
    },
    remove: (name) => {
      calls.push(`remove:${name}`);
      return Promise.resolve();
    },
  };
  return { skills, calls };
};

const handlers = (skills: SkillsStore) =>
  createSkillsHandlers({ skills } as unknown as HandlerContext);

test('skills.list returns what the store lists', async () => {
  const { skills } = fixture([{ name: 'review', body: 'x' }]);
  expect(await handlers(skills)['skills.list']({}, peer)).toEqual({
    skills: [{ name: 'review', body: 'x' }],
  });
});

test('skills.write delegates to the store and returns {}', async () => {
  const { skills, calls } = fixture([]);
  expect(await handlers(skills)['skills.write']({ name: 'deploy', body: 'steps' }, peer)).toEqual(
    {},
  );
  expect(calls).toEqual(['write:deploy:steps']);
});

test('skills.delete delegates to the store and returns {}', async () => {
  const { skills, calls } = fixture([]);
  expect(await handlers(skills)['skills.delete']({ name: 'review' }, peer)).toEqual({});
  expect(calls).toEqual(['remove:review']);
});
