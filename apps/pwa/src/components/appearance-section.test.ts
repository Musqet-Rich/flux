import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { fakeAppearance } from '../../test/fake-appearance.ts';
import AppearanceSection from './AppearanceSection.vue';

test('offers the three modes and the size slider, each applied at once', async () => {
  const a = fakeAppearance();
  const wrapper = mount(AppearanceSection, { props: { appearance: a } });
  const mode = wrapper.find<HTMLSelectElement>('#flux-mode');
  expect(mode.element.value).toBe('system');
  expect(mode.findAll('option').map((o) => o.text())).toEqual(['System', 'Light', 'Dark']);
  expect(mode.attributes('aria-describedby')).toBe('flux-mode-hint');
  expect(wrapper.find('#flux-mode-hint').exists()).toBe(true);
  // The theme and font pickers sit between the scheme and the size.
  expect(wrapper.findAll('select, input').map((el) => el.attributes('id'))).toEqual([
    'flux-mode',
    'flux-theme',
    'flux-font-text',
    'flux-font-code',
    'flux-font-size',
  ]);
  await mode.setValue('light');
  expect(a.choices.mode).toBe('light');
  expect(a.scheme.value).toBe('light');

  const size = wrapper.find<HTMLInputElement>('#flux-font-size');
  expect(size.attributes()).toMatchObject({ type: 'range', min: '12', max: '22', step: '1' });
  expect(size.element.value).toBe('15');
  expect(size.attributes('aria-valuetext')).toBe('15 px');
  expect(wrapper.find('output').text()).toBe('15 px');
  await size.setValue('18');
  expect(a.choices.fontSize).toBe(18);
  expect(wrapper.find('output').text()).toBe('18 px');
});
