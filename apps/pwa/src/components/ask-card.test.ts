import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import AskCard from './AskCard.vue';

const bare = { askId: 'q1', question: 'Ship it?', timeoutAt: '2026-01-01T01:00:00Z' };
const ask = { ...bare, options: ['yes', 'no'] };

test('answers once, with a tapped option, then locks', async () => {
  const wrapper = mount(AskCard, { props: { ask } });
  expect(wrapper.find('.question').text()).toBe('Ship it?');
  await wrapper.findAll('.options button')[1]?.trigger('click');
  expect(wrapper.emitted('answer')).toEqual([['no']]);
  expect(wrapper.find('.ask').classes()).toContain('answered');
  expect(wrapper.find('.options button').attributes('disabled')).toBeDefined();
  await wrapper.findAll('.options button')[0]?.trigger('click');
  await wrapper.find('input').setValue('later');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('answer')).toEqual([['no']]);
});

test('answers with typed text, ignores empty text, and shows no options when there are none', async () => {
  const wrapper = mount(AskCard, { props: { ask: bare } });
  expect(wrapper.find('.options').exists()).toBe(false);
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('answer')).toBeUndefined();
  await wrapper.find('input').setValue('  later  ');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('answer')).toEqual([['later']]);
  expect(wrapper.find('input').element.value).toBe('');
});
