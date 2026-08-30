import type { Skill } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import SkillsEditor from './SkillsEditor.vue';

// A box whose skills are a mutable list the write/delete handlers edit, so a save re-lists the
// real state, exactly as the daemon does.
const skillBox = async (initial: Skill[]) => {
  const skills = [...initial];
  return pairedStore([], {
    'skills.list': () => ({ skills: skills.toSorted((a, b) => a.name.localeCompare(b.name)) }),
    'skills.write': (p) => {
      const found = skills.find((s) => s.name === p.name);
      if (found === undefined) skills.push({ name: p.name, body: p.body });
      else found.body = p.body;
      return {};
    },
    'skills.delete': (p) => {
      const at = skills.findIndex((s) => s.name === p.name);
      if (at !== -1) skills.splice(at, 1);
      return {};
    },
  });
};

test('lists skills, edits a body and saves it through skills.write', async () => {
  const box = await skillBox([{ name: 'review', body: '# Review\n' }]);
  const wrapper = mount(SkillsEditor, { props: { store: box.store } });
  await until(() => box.store.state.skills !== null);
  await flushPromises();
  expect(wrapper.findAll('.skill-row').length).toBe(1);
  expect(wrapper.find<HTMLInputElement>('.skill-name').element.value).toBe('review');
  expect(wrapper.find<HTMLInputElement>('.skill-name').element.disabled).toBe(true);
  expect(wrapper.find('.skill-save').attributes('disabled')).toBeDefined();
  await wrapper.find('.skill-body').setValue('# Review\nBe kind.\n');
  expect(wrapper.find('.skill-save').attributes('disabled')).toBeUndefined();
  await wrapper.find('.skill-save').trigger('click');
  await until(() => box.store.state.skills?.[0]?.body === '# Review\nBe kind.\n');
  await flushPromises();
  expect(box.calls('skills.write')).toEqual([{ name: 'review', body: '# Review\nBe kind.\n' }]);
  expect(wrapper.find('.skill-save').text()).toBe('Saved');
  box.store.stop();
});

test('adds a new skill and writes it under the typed name', async () => {
  const box = await skillBox([]);
  const wrapper = mount(SkillsEditor, { props: { store: box.store } });
  await until(() => box.store.state.skills !== null);
  await flushPromises();
  expect(wrapper.find('.hint').text()).toContain('No skills');
  await wrapper.find('.skill-add').trigger('click');
  await wrapper.find('.skill-name').setValue('deploy');
  await wrapper.find('.skill-body').setValue('steps');
  await wrapper.find('.skill-save').trigger('click');
  await until(() => box.calls('skills.write').length === 1);
  await flushPromises();
  expect(box.calls('skills.write')).toEqual([{ name: 'deploy', body: 'steps' }]);
  box.store.stop();
});

test('deletes a skill through skills.delete and drops the row', async () => {
  const box = await skillBox([{ name: 'review', body: 'x' }]);
  const wrapper = mount(SkillsEditor, { props: { store: box.store } });
  await until(() => box.store.state.skills !== null);
  await flushPromises();
  await wrapper.find('.skill-delete').trigger('click');
  await until(() => box.store.state.skills?.length === 0);
  await flushPromises();
  expect(box.calls('skills.delete')).toEqual([{ name: 'review' }]);
  expect(wrapper.findAll('.skill-row').length).toBe(0);
  box.store.stop();
});

test('flags an unsafe name and blocks its save', async () => {
  const box = await skillBox([]);
  const wrapper = mount(SkillsEditor, { props: { store: box.store } });
  await until(() => box.store.state.skills !== null);
  await flushPromises();
  await wrapper.find('.skill-add').trigger('click');
  await wrapper.find('.skill-name').setValue('a/b');
  await wrapper.find('.skill-body').setValue('body');
  expect(wrapper.find('.skill-error').exists()).toBe(true);
  expect(wrapper.find('.skill-save').attributes('disabled')).toBeDefined();
  await wrapper.find('.skill-name').setValue('ok');
  expect(wrapper.find('.skill-error').exists()).toBe(false);
  expect(wrapper.find('.skill-save').attributes('disabled')).toBeUndefined();
  box.store.stop();
});

test('an older daemon without skills degrades to the no-skills hint', async () => {
  // No skills.* handlers: the box answers not_found, which the store reads as an empty list.
  const box = await pairedStore([]);
  const wrapper = mount(SkillsEditor, { props: { store: box.store } });
  await until(() => box.store.state.skills !== null);
  await flushPromises();
  expect(box.store.state.skills).toEqual([]);
  expect(wrapper.find('.hint').text()).toContain('No skills');
  box.store.stop();
});
