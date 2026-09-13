import type { VueWrapper } from '@vue/test-utils';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { settingsFixture } from '../../test/settings-fixture.ts';
import type { SettingsEntry } from './settings-index.ts';
import { settingsIndex } from './settings-index.ts';
import SettingsView from './SettingsView.vue';

const open = async (): Promise<{ wrapper: VueWrapper; stop: () => void }> => {
  const box = await pairedStore([], {
    'devices.list': () => [
      { deviceId: 'dev-1', name: 'phone', pairedAt: '2026-01-01T00:00:00Z', current: true },
    ],
    // One agent with a tool list, so every label the editor can show is on screen.
    'settings.get': () =>
      settingsFixture({ agents: [{ name: 'Help', tools: { mode: 'allow', list: ['Read'] } }] }),
  });
  // Attached, so `isVisible` sees what `v-show` did.
  const wrapper = mount(SettingsView, { props: { store: box.store }, attachTo: document.body });
  await until(() => box.store.state.settings !== null);
  await until(() => box.store.state.devices.length === 1);
  await until(() => box.store.state.updateCheck !== null);
  await flushPromises();
  return {
    wrapper,
    stop: () => {
      wrapper.unmount();
      box.store.stop();
    },
  };
};

// The `data-setting` unit a labelled control belongs to: the nearest one up the tree.
const unitOf = (el: Element): string =>
  el.closest<HTMLElement>('[data-setting]')?.dataset['setting'] ?? '';

// A label's own text: without the control it wraps, a hint inside it, or a `v-if` comment.
const ownText = (node: ChildNode): string => {
  if (node instanceof Text) return node.data;
  if (node instanceof Element && !node.matches('select, input, textarea, .hint')) {
    return node.textContent ?? '';
  }
  return '';
};
const ownWords = (el: Element): string[] =>
  [...el.childNodes]
    .map((node) => ownText(node))
    .join(' ')
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== '');

const entryOf = (id: string): SettingsEntry | undefined =>
  settingsIndex.entries.find((e) => e.id === id);

// The headings and `data-setting` units on screen, hidden ones excluded.
const shown = (wrapper: VueWrapper): { headings: string[]; settings: string[] } => ({
  headings: wrapper
    .findAll('h2')
    .filter((h) => h.isVisible())
    .map((h) => h.text()),
  settings: wrapper
    .findAll('[data-setting]')
    .filter((el) => el.isVisible())
    .map((el) => el.attributes('data-setting') ?? ''),
});

test('fetches devices and settings on open, shows every section, and goes back', async () => {
  const { wrapper, stop } = await open();
  expect(wrapper.findAll('h2').map((h) => h.text())).toEqual([
    'Devices',
    'This device',
    'Appearance',
    'Flux',
    'Agents',
    'Skills',
    'Harness config',
  ]);
  expect(wrapper.find('.device .label').text()).toBe('phone');
  expect(wrapper.find('#flux-repos').element).toBeInstanceOf(HTMLInputElement);
  expect(wrapper.find('#flux-sound').element).toBeInstanceOf(HTMLSelectElement);
  expect(wrapper.find('#flux-send-key').element).toBeInstanceOf(HTMLSelectElement);
  expect(wrapper.find('#flux-mode').element).toBeInstanceOf(HTMLSelectElement);
  expect(wrapper.find('#harness-md').element).toBeInstanceOf(HTMLTextAreaElement);
  await wrapper.find('.toolbar button').trigger('click');
  expect(wrapper.emitted('back')).toEqual([[]]);
  stop();
});

// The index is by hand (settings-index.ts): this is what keeps it honest. Every unit on the
// screen is an entry and every entry is on the screen; every labelled control belongs to a
// field entry or to a whole-section editor, never to a field-level section's root (where it
// would show under every search); and every word of a label is a word of its entry, so the
// label an operator reads is what finds it.
test('the search index and the screen agree, and every labelled control is searchable', async () => {
  const { wrapper, stop } = await open();
  const onScreen = wrapper.findAll('[data-setting]').map((el) => el.attributes('data-setting'));
  expect(new Set(onScreen)).toEqual(new Set(settingsIndex.entries.map((e) => e.id)));
  expect(onScreen.length).toBe(new Set(onScreen).size);

  const labels = wrapper.findAll('.sections label, .sections legend');
  expect(labels.length).toBeGreaterThan(20);
  // A field-level section's root, or no unit at all: neither is a place a label may sit.
  const notAUnit = new Set<string | null>([...settingsIndex.entries.map((e) => e.section), '']);
  const stray = labels.filter((l) => notAUnit.has(unitOf(l.element)));
  expect(stray.map((l) => `${unitOf(l.element)}: ${l.text()}`)).toEqual([]);

  const unindexed = labels.flatMap((l) => {
    const terms = entryOf(unitOf(l.element))?.terms;
    return ownWords(l.element)
      .filter((word) => !(terms?.includes(word) === true))
      .map((word) => `${unitOf(l.element)}: ${word}`);
  });
  expect(unindexed).toEqual([]);
  stop();
});

test('typing filters to the matching fields, their headings, or the whole editor', async () => {
  const { wrapper, stop } = await open();
  const search = wrapper.find('input[type="search"]');
  await search.setValue('dark');
  expect(shown(wrapper)).toEqual({
    headings: ['Appearance'],
    settings: ['appearance', 'flux-mode'],
  });
  expect(wrapper.find('#flux-theme').isVisible()).toBe(false);

  await search.setValue('claude.md');
  expect(shown(wrapper).headings).toEqual(['Harness config']);
  expect(wrapper.find('#harness-md').isVisible()).toBe(true);

  // The Flux form's Save goes with its fields, not with its read-only rows.
  await search.setValue('repos');
  expect(shown(wrapper).settings).toEqual(['flux', 'flux-repos']);
  expect(wrapper.find('button[type="submit"]').isVisible()).toBe(true);
  await search.setValue('version');
  expect(shown(wrapper).settings).toEqual(['flux', 'flux-versions']);
  expect(wrapper.find('button[type="submit"]').isVisible()).toBe(false);
  stop();
});

test('nothing matching says so, and clearing or Escape brings everything back', async () => {
  const { wrapper, stop } = await open();
  const search = wrapper.find('input[type="search"]');
  await search.setValue('  zebra ');
  expect(shown(wrapper).headings).toEqual([]);
  expect(wrapper.find('.no-match').text()).toBe('Nothing matches “zebra”.');
  expect(wrapper.find('.sections').classes()).toContain('filtered');

  const esc = 'Escape';
  await search.trigger('keydown', { key: esc });
  expect(wrapper.find('.no-match').exists()).toBe(false);
  expect(shown(wrapper).headings).toHaveLength(7);
  expect(wrapper.find('.sections').classes()).not.toContain('filtered');
  expect((search.element as HTMLInputElement).value).toBe('');
  stop();
});
