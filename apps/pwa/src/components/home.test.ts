import { pairing } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import Home from './Home.vue';

const link = pairing.url('https://relay.example', {
  boxPub: new Uint8Array(32),
  secret: new Uint8Array(pairing.secretLength),
});

test('presents Flux and its setup on the unpaired landing', () => {
  const wrapper = mount(Home, { props: { phase: 'unpaired', error: null } });
  expect(wrapper.find('h1').text()).toBe('Give coding agents their own computer.');
  const headings = wrapper.findAll('h2').map((node) => node.text());
  expect(headings).toContain('What you get');
  expect(headings).toContain('Set up in a minute');
  expect(wrapper.text()).toContain('flux pair');
  const steps = wrapper.findAll('.steps li');
  expect(steps.length).toBe(3);
});

test('embeds the connect card and forwards a pasted pairing link', async () => {
  const wrapper = mount(Home, { props: { phase: 'unpaired', error: null } });
  expect(wrapper.find('.pair h2').text()).toBe('Pair with your box');
  await wrapper.find('input').setValue(link);
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('pair')).toEqual([['https://relay.example', new URL(link).hash]]);
});

test('surfaces the store error and pairing progress from the connect card', async () => {
  const wrapper = mount(Home, { props: { phase: 'pairing', error: null } });
  const connect = wrapper.find('.pair');
  expect(connect.find('h2').text()).toBe('Pairing…');
  await wrapper.setProps({ phase: 'unpaired', error: 'no pair.request' });
  expect(wrapper.find('.error').text()).toBe('no pair.request');
});
