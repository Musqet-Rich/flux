import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { fakeAppearance } from '../../test/fake-appearance.ts';
import { fonts } from '../appearance/fonts.ts';
import { presets } from '../appearance/presets.ts';
import { theme } from '../appearance/theme.ts';
import FontPicker from './FontPicker.vue';

const { nord } = presets;

const optionsOf = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('option').map((o) => o.text());

test('offers the platform font and the ten families, a pick put into the theme in force', async () => {
  const a = fakeAppearance();
  const wrapper = mount(FontPicker, { props: { appearance: a, part: 'code' } });
  const select = wrapper.find<HTMLSelectElement>('#flux-font-code');
  expect(wrapper.find('label').text()).toBe('Code font');
  expect(select.element.value).toBe('system');
  expect(optionsOf(wrapper)).toEqual(['System', ...fonts.families.code]);
  // Default in force: the theme becomes a copy of it that carries the family.
  await select.setValue('JetBrains Mono');
  expect(a.choices.theme).toEqual({ ...theme.default, fonts: { code: 'JetBrains Mono' } });
  expect(select.element.value).toBe('JetBrains Mono');
});

test('a pick keeps the colours and the other family, and System takes only its own away', async () => {
  const a = fakeAppearance();
  a.setTheme({ ...nord, fonts: { code: 'Nova Mono' } });
  const wrapper = mount(FontPicker, { props: { appearance: a, part: 'text' } });
  const select = wrapper.find<HTMLSelectElement>('#flux-font-text');
  expect(select.element.value).toBe('system');
  await select.setValue('Sen');
  expect(a.choices.theme).toEqual({ ...nord, fonts: { text: 'Sen', code: 'Nova Mono' } });
  await select.setValue('system');
  expect(a.choices.theme).toEqual({ ...nord, fonts: { code: 'Nova Mono' } });
});

test('with neither family chosen the theme carries no fonts at all', async () => {
  const a = fakeAppearance();
  a.setTheme({ ...nord, fonts: { code: 'Nova Mono' } });
  const wrapper = mount(FontPicker, { props: { appearance: a, part: 'code' } });
  await wrapper.find('#flux-font-code').setValue('system');
  expect(a.choices.theme).toEqual(nord);
});

test('a family the app does not ship is shown as chosen and marked, not silently System', async () => {
  const a = fakeAppearance();
  a.setTheme({ name: 'x', fonts: { text: 'Comic Sans' } });
  const wrapper = mount(FontPicker, { props: { appearance: a, part: 'text' } });
  const select = wrapper.find<HTMLSelectElement>('#flux-font-text');
  expect(select.element.value).toBe('Comic Sans');
  expect(optionsOf(wrapper).at(-1)).toBe('Comic Sans (not available)');
  await select.setValue('Inter');
  expect(a.choices.theme).toEqual({ name: 'x', fonts: { text: 'Inter' } });
  expect(optionsOf(wrapper)).toEqual(['System', ...fonts.families.text]);
});
