import { pairing } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import Home from './Home.vue';

const link = pairing.url('https://relay.example', {
  boxPub: new Uint8Array(32),
  secret: new Uint8Array(pairing.secretLength),
});

test('presents the hero, the four things you get, and the four setup steps', () => {
  const wrapper = mount(Home, { props: { phase: 'unpaired', error: null } });
  expect(wrapper.find('h1').text()).toBe('Give coding agents their own computer.');
  const titles = wrapper.findAll('.cell h3').map((node) => node.text());
  expect(titles).toEqual([
    'Agents on a box',
    'Review from anywhere',
    "Know when you're needed",
    'End-to-end encrypted',
  ]);
  const steps = wrapper.findAll('.steps li');
  expect(steps.length).toBe(4);
  expect(wrapper.text()).toContain('flux pair');
  // The install command and relay env line are load-bearing on the public page: a typo in either
  // would silently break setup, so assert them verbatim.
  expect(wrapper.text()).toContain(
    'curl -fsSL https://raw.githubusercontent.com/Musqet-Rich/flux/main/scripts/install.sh | sh',
  );
  expect(wrapper.text()).toContain('FLUX_RELAY_URL=https://fluxagent.me');
});

test('keeps a sound heading order: the single h1, then h2s above the feature h3s', () => {
  const wrapper = mount(Home, { props: { phase: 'unpaired', error: null } });
  const levels = wrapper.findAll('h1, h2, h3').map((node) => node.element.tagName);
  expect(levels[0]).toBe('H1');
  expect(levels.indexOf('H2')).toBeLessThan(levels.indexOf('H3'));
  expect(wrapper.findAll('h1').length).toBe(1);
});

test('mounts the hero flow canvas', () => {
  const wrapper = mount(Home, { props: { phase: 'unpaired', error: null } });
  expect(wrapper.find('canvas').exists()).toBe(true);
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
