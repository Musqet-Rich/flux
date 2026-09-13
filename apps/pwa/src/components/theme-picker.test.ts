import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';

import { fakeAppearance } from '../../test/fake-appearance.ts';
import { presets } from '../appearance/presets.ts';
import { theme } from '../appearance/theme.ts';
import ThemePicker from './ThemePicker.vue';

// The clipboard each test installs is taken away after it.
const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (original === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
  else Object.defineProperty(navigator, 'clipboard', original);
});

const clipboard = (
  text: string | null,
): { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> } => {
  const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const readText = vi.fn<() => Promise<string>>(() =>
    text === null ? Promise.reject(new Error('denied')) : Promise.resolve(text),
  );
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, readText },
    configurable: true,
  });
  return { writeText, readText };
};

const { nord } = presets;
const custom = { name: 'Nord', dark: { accent: '#ff00ff' } };

const optionsOf = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('option').map((o) => o.text());

test('offers the default and the presets, a pick applied at once and the default a pick too', async () => {
  const a = fakeAppearance();
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  const select = wrapper.find<HTMLSelectElement>('#flux-theme');
  expect(select.element.value).toBe('default');
  expect(optionsOf(wrapper)).toEqual(['Default', 'Candlelight', 'Nord', 'Solarized']);
  expect(select.attributes('aria-describedby')).toBe(wrapper.find('.hint').attributes('id'));
  await select.setValue('Nord');
  expect(a.choices.theme).toEqual(nord);
  await select.setValue('default');
  expect(a.choices.theme).toBeNull();
});

test('a chosen preset is recognised as itself when the picker opens again', () => {
  const a = fakeAppearance();
  a.setTheme(nord);
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  expect(wrapper.find<HTMLSelectElement>('#flux-theme').element.value).toBe('Nord');
});

const fonts = { text: 'Sen', code: 'Kode Mono' };

test('a pick leaves the fonts chosen as they are', async () => {
  const a = fakeAppearance();
  a.setFonts(fonts);
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  await wrapper.find('#flux-theme').setValue('Solarized');
  expect(a.choices.theme).toEqual(presets.solarized);
  expect(a.choices.fonts).toEqual(fonts);
});

test('Copy folds the fonts chosen into the JSON, so a shared theme carries them', async () => {
  const { writeText } = clipboard('');
  const a = fakeAppearance();
  a.setTheme(nord);
  a.setFonts(fonts);
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  await wrapper.get('button:nth-of-type(1)').trigger('click');
  await flushPromises();
  expect(writeText).toHaveBeenCalledWith(theme.stringify({ ...nord, fonts }));
  expect(wrapper.find<HTMLSelectElement>('#flux-theme').element.value).toBe('Nord');
});

// A shared theme is the whole thing: what it names of fonts is what is chosen after.
test('Paste takes the fonts out of the JSON and applies them, or takes them away', async () => {
  clipboard(JSON.stringify({ ...custom, fonts: { code: 'Nova Mono' } }));
  const a = fakeAppearance();
  a.setFonts(fonts);
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  await wrapper.get('button:nth-of-type(2)').trigger('click');
  await flushPromises();
  expect(a.choices.theme).toEqual(custom);
  expect(a.choices.fonts).toEqual({ code: 'Nova Mono' });
  clipboard(JSON.stringify(nord));
  await wrapper.get('button:nth-of-type(2)').trigger('click');
  await flushPromises();
  expect(a.choices.theme).toEqual(nord);
  expect(a.choices.fonts).toEqual({});
  expect(wrapper.find<HTMLSelectElement>('#flux-theme').element.value).toBe('Nord');
});

test('Copy puts the theme in force on the clipboard as JSON, the default included', async () => {
  const { writeText } = clipboard('');
  const a = fakeAppearance();
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  await wrapper.get('button:nth-of-type(1)').trigger('click');
  await flushPromises();
  expect(writeText).toHaveBeenCalledWith(theme.stringify(theme.default));
  expect(wrapper.find('[role="status"]').text()).toBe('Copied');
  a.setTheme(nord);
  await wrapper.get('button:nth-of-type(1)').trigger('click');
  await flushPromises();
  expect(writeText).toHaveBeenLastCalledWith(theme.stringify(nord));
});

test('Paste applies a theme from the clipboard, listed under its name as pasted', async () => {
  clipboard(JSON.stringify(custom));
  const a = fakeAppearance();
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  await wrapper.get('button:nth-of-type(2)').trigger('click');
  await flushPromises();
  expect(a.choices.theme).toEqual(custom);
  expect(wrapper.find('[role="status"]').text()).toBe('Nord applied');
  expect(optionsOf(wrapper)).toEqual([
    'Default',
    'Candlelight',
    'Nord',
    'Solarized',
    'Nord (pasted)',
  ]);
  expect(wrapper.find<HTMLSelectElement>('#flux-theme').element.value).toBe('pasted');
  // Choosing a preset over it takes the pasted entry away.
  await wrapper.find('#flux-theme').setValue('Solarized');
  expect(optionsOf(wrapper)).toEqual(['Default', 'Candlelight', 'Nord', 'Solarized']);
  expect(wrapper.find('[role="status"]').text()).toBe('');
});

// Firefox fires `change` for every arrow-key step through a select, so the pasted entry can be
// landed on; it must not read as a pick of nothing.
test('landing on the pasted entry keeps the pasted theme', async () => {
  clipboard(JSON.stringify(custom));
  const a = fakeAppearance();
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  await wrapper.get('button:nth-of-type(2)').trigger('click');
  await flushPromises();
  await wrapper.find('#flux-theme').setValue('pasted');
  expect(a.choices.theme).toEqual(custom);
  expect(wrapper.find('[role="status"]').text()).toBe('Nord applied');
});

test('Paste refuses what is not a theme, saying why, and keeps the theme in force', async () => {
  clipboard('{"name":"x","dark":{"bg":"red"}}');
  const a = fakeAppearance();
  a.setTheme(nord);
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  await wrapper.get('button:nth-of-type(2)').trigger('click');
  await flushPromises();
  expect(a.choices.theme).toEqual(nord);
  expect(wrapper.find('[role="status"]').text()).toBe(
    'Not a theme: dark.bg is not a colour: a colour is #rgb, #rrggbb or #rrggbbaa',
  );
});

test('a clipboard that cannot be read is said so, not thrown', async () => {
  clipboard(null);
  const a = fakeAppearance();
  const wrapper = mount(ThemePicker, { props: { appearance: a } });
  await wrapper.get('button:nth-of-type(2)').trigger('click');
  await flushPromises();
  expect(a.choices.theme).toBeNull();
  expect(wrapper.find('[role="status"]').text()).toBe('The clipboard could not be read');
});
