import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { ClientError } from '../client/client-error.ts';
import SessionMenu from './SessionMenu.vue';

const dirty = '2 uncommitted files and 1 unpushed commit';

// The menu is busy until the box has answered; `busy` is the component's own ref.
const settled = async (wrapper: ReturnType<typeof mount>): Promise<void> => {
  await until(() => Reflect.get(wrapper.vm, 'busy') === false);
  await flushPromises();
};

const setup = async (refusals = 0) => {
  let refused = 0;
  const box = await pairedStore([], {
    'sessions.clear': () => ({}),
    'sessions.archive': (p) => {
      if (p.discard !== true && refused < refusals) {
        refused += 1;
        throw new ClientError('dirty', dirty);
      }
      return {};
    },
    'sessions.list': () => [],
  });
  const wrapper = mount(SessionMenu, { props: { store: box.store, session: 's1' } });
  return { ...box, wrapper };
};

test('the menu opens from a menu button and offers clear, archive and delete', async () => {
  const { wrapper, calls, store } = await setup();
  const trigger = wrapper.find('button[aria-haspopup="menu"]');
  expect(trigger.attributes('aria-expanded')).toBe('false');
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  await trigger.trigger('click');
  expect(trigger.attributes('aria-expanded')).toBe('true');
  expect(wrapper.findAll('[role="menuitem"]').map((b) => b.text())).toEqual([
    'Clear context',
    'Archive',
    'Delete…',
  ]);
  await wrapper.findAll('[role="menuitem"]')[0]?.trigger('click');
  await until(() => calls('sessions.clear').length === 1);
  expect(calls('sessions.clear')).toEqual([{ session: 's1' }]);
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  await settled(wrapper);
  expect(wrapper.emitted('closed')).toBeUndefined();
  await trigger.trigger('click');
  await wrapper.findAll('[role="menuitem"]')[1]?.trigger('click');
  await until(() => calls('sessions.archive').length === 1);
  expect(calls('sessions.archive')).toEqual([{ session: 's1' }]);
  await settled(wrapper);
  expect(wrapper.emitted('closed')).toEqual([[]]);
  store.stop();
});

test('delete confirms what to remove; a dirty refusal asks again before discarding', async () => {
  const { wrapper, calls, store } = await setup(1);
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[2]?.trigger('click');
  const boxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]');
  expect(boxes.map((b) => b.element.checked)).toEqual([true, false]);
  await boxes[1]?.setValue(true);
  await wrapper.find('form.confirm').trigger('submit');
  await until(() => calls('sessions.archive').length === 1);
  expect(calls('sessions.archive')).toEqual([
    { session: 's1', removeWorktree: true, deleteBranch: true, discard: false },
  ]);
  await settled(wrapper);
  expect(wrapper.find('.dirty').text()).toBe(`${dirty}. Discard it?`);
  expect(wrapper.emitted('closed')).toBeUndefined();
  expect(wrapper.find('button[type="submit"]').text()).toBe('Discard changes');
  await wrapper.find('form.confirm').trigger('submit');
  await until(() => calls('sessions.archive').length === 2);
  expect(calls('sessions.archive')[1]).toEqual({
    session: 's1',
    removeWorktree: true,
    deleteBranch: true,
    discard: true,
  });
  await settled(wrapper);
  expect(wrapper.emitted('closed')).toEqual([[]]);
  expect(wrapper.find('form.confirm').exists()).toBe(false);
  store.stop();
});

test('cancel closes the confirm without a call', async () => {
  const { wrapper, calls, store } = await setup();
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[2]?.trigger('click');
  expect(wrapper.find('form.confirm').exists()).toBe(true);
  await wrapper.find('form.confirm button.secondary').trigger('click');
  expect(wrapper.find('form.confirm').exists()).toBe(false);
  expect(calls('sessions.archive')).toEqual([]);
  store.stop();
});
