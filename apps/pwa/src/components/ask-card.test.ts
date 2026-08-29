import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import AskCard from './AskCard.vue';

const bare = { askId: 'q1', question: 'Ship it?', timeoutAt: '2026-01-01T01:00:00Z' };
const ask = { ...bare, options: ['yes', 'no'] };

test('answers with a tapped option or typed text', async () => {
  const wrapper = mount(AskCard, { props: { ask } });
  expect(wrapper.find('.question').text()).toBe('Ship it?');
  await wrapper.findAll('.options button')[1]?.trigger('click');
  expect(wrapper.emitted('answer')).toEqual([['no']]);
  await wrapper.find('input').setValue('  later  ');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('answer')).toEqual([['no'], ['later']]);
  expect(wrapper.find('input').element.value).toBe('');
});

test('ignores an empty typed answer and shows no options when there are none', async () => {
  const wrapper = mount(AskCard, { props: { ask: bare } });
  expect(wrapper.find('.options').exists()).toBe(false);
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('answer')).toBeUndefined();
});
