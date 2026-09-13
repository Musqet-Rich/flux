import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { fakeAppearance } from '../../test/fake-appearance.ts';
import { fonts } from '../appearance/fonts.ts';
import FontPicker from './FontPicker.vue';

const optionsOf = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('option').map((o) => o.text());

test('offers the platform font and the ten families, a pick applied at once', async () => {
  const a = fakeAppearance();
  const wrapper = mount(FontPicker, { props: { appearance: a, part: 'code' } });
  const select = wrapper.find<HTMLSelectElement>('#flux-font-code');
  expect(wrapper.find('label').text()).toBe('Code font');
  expect(select.element.value).toBe('');
  expect(optionsOf(wrapper)).toEqual(['System', ...fonts.families.code]);
  await select.setValue('JetBrains Mono');
  expect(a.choices.fonts).toEqual({ code: 'JetBrains Mono' });
  expect(select.element.value).toBe('JetBrains Mono');
});

test('a pick keeps the other family, and System takes only its own away', async () => {
  const a = fakeAppearance();
  a.setFonts({ code: 'Nova Mono' });
  const wrapper = mount(FontPicker, { props: { appearance: a, part: 'text' } });
  const select = wrapper.find<HTMLSelectElement>('#flux-font-text');
  expect(select.element.value).toBe('');
  await select.setValue('Sen');
  expect(a.choices.fonts).toEqual({ text: 'Sen', code: 'Nova Mono' });
  await select.setValue('');
  expect(a.choices.fonts).toEqual({ code: 'Nova Mono' });
});

test('a family the app does not ship is shown as chosen and marked, not silently System', async () => {
  const a = fakeAppearance();
  a.setFonts({ text: 'Comic Sans' });
  const wrapper = mount(FontPicker, { props: { appearance: a, part: 'text' } });
  const select = wrapper.find<HTMLSelectElement>('#flux-font-text');
  expect(select.element.value).toBe('Comic Sans');
  expect(optionsOf(wrapper).at(-1)).toBe('Comic Sans (not available for text)');
  await select.setValue('Inter');
  expect(a.choices.fonts).toEqual({ text: 'Inter' });
  expect(optionsOf(wrapper)).toEqual(['System', ...fonts.families.text]);
});
