import { flushPromises, mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { daemonLabels } from './daemon-labels.ts';
import DaemonPicker from './DaemonPicker.vue';

// The header's daemon picker (ADR 0037): absent with one daemon paired, the open daemon's name
// with a menu of the others and "Pair another daemon" once there are two, and names that two
// daemons share told apart by the start of their ids.

const OTHER_DAEMON = 'hobbyDaemonId';

test('stays out of the header until a second daemon is paired, then switches to the chosen one', async () => {
  const box = await pairedStore();
  const switchDaemon = vi.fn<(daemon: string) => Promise<boolean>>(() => Promise.resolve(true));
  const store = { ...box.store, switchDaemon };
  const wrapper = mount(DaemonPicker, { props: { store }, attachTo: document.body });
  expect(wrapper.find('.picker').exists()).toBe(false);
  box.store.state.daemons.push({ id: OTHER_DAEMON, name: 'hobby' });
  await flushPromises();
  const button = wrapper.find('.current');
  expect(button.attributes('aria-label')).toBe('Daemon: box');
  expect(button.attributes('aria-expanded')).toBe('false');
  await button.trigger('click');
  const items = wrapper.findAll('[role="menuitem"]').map((b) => b.text());
  expect(items).toEqual(['hobby', 'Pair another daemon']);
  await wrapper.find('[role="menuitem"]').trigger('click');
  expect(switchDaemon).toHaveBeenCalledWith(OTHER_DAEMON);
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  wrapper.unmount();
  box.store.stop();
});

test('"Pair another daemon" opens the pairing dialog and Cancel closes it', async () => {
  const box = await pairedStore();
  box.store.state.daemons.push({ id: OTHER_DAEMON, name: 'hobby' });
  const wrapper = mount(DaemonPicker, { props: { store: box.store }, attachTo: document.body });
  await wrapper.find('.current').trigger('click');
  await wrapper.find('.pair-another').trigger('click');
  const dialog = wrapper.find('[role="dialog"]');
  expect(dialog.attributes('aria-label')).toBe('Pair another daemon');
  expect(dialog.find('h2').text()).toBe('Pair another daemon');
  expect(dialog.text()).toContain("on the daemon's machine");
  await dialog.find('.actions .secondary').trigger('click');
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  wrapper.unmount();
  box.store.stop();
});

test('labels name each daemon, and a shared or missing name is told apart', () => {
  const labels = daemonLabels([
    { id: 'aaaaaa111', name: 'flux' },
    { id: 'bbbbbb222', name: 'flux' },
    { id: 'cccccc333', name: 'work' },
    { id: 'dddddd444', name: null },
  ]);
  expect([...labels.values()]).toEqual([
    'flux (aaaaaa)',
    'flux (bbbbbb)',
    'work',
    'Unnamed daemon',
  ]);
});
