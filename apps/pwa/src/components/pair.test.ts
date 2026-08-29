import { pairing } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import Pair from './Pair.vue';

const link = pairing.url('https://relay.example', {
  boxPub: new Uint8Array(32),
  secret: new Uint8Array(pairing.secretLength),
});

test('accepts a pasted pairing link and rejects anything else', async () => {
  const wrapper = mount(Pair, { props: { phase: 'unpaired', error: null } });
  expect(wrapper.find('h1').text()).toBe('Pair with your box');
  await wrapper.find('input').setValue('not a url');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.find('.error').text()).toBe('That is not a pairing link.');
  await wrapper.find('input').setValue('https://relay.example/#nope');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('pair')).toBeUndefined();
  await wrapper.find('input').setValue(link);
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('pair')).toEqual([['https://relay.example', new URL(link).hash]]);
  expect(wrapper.find('.error').exists()).toBe(false);
});

test('shows progress while booting or pairing and the store error afterwards', async () => {
  const wrapper = mount(Pair, { props: { phase: 'booting', error: null } });
  expect(wrapper.find('h1').text()).toBe('Loading…');
  expect(wrapper.find('input').attributes('disabled')).toBeDefined();
  await wrapper.setProps({ phase: 'pairing' });
  expect(wrapper.find('h1').text()).toBe('Pairing…');
  await wrapper.setProps({ phase: 'unpaired', error: 'no pair.request' });
  expect(wrapper.find('.error').text()).toBe('no pair.request');
});
