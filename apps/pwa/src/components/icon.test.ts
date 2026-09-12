import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { icons } from '../icons/icons.ts';
import Icon from './Icon.vue';

test('draws the named icon as one path in a 256 viewBox, hidden from assistive tech', () => {
  const wrapper = mount(Icon, { props: { name: 'send' } });
  const svg = wrapper.find('svg');
  expect(svg.attributes('viewBox')).toBe('0 0 256 256');
  expect(svg.attributes('aria-hidden')).toBe('true');
  expect(wrapper.find('path').attributes('d')).toBe(icons.send);
});

test('every icon in the map is a non-empty path string', () => {
  for (const d of Object.values(icons)) {
    expect(d).toMatch(/^M[\d.,\s\-A-Za-z]+$/u);
  }
});
