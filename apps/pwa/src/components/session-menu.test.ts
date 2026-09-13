import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { ClientError } from '../client/client-error.ts';
import SessionMenu from './SessionMenu.vue';

const dirty = '2 uncommitted files and 1 unpushed commit';
const escape = 'Escape';

// The menu is busy until the box has answered; `busy` is the component's own ref.
const settled = async (wrapper: ReturnType<typeof mount>): Promise<void> => {
  await until(() => Reflect.get(wrapper.vm, 'busy') === false);
  await flushPromises();
};

const setup = async (refusals = 0) => {
  let refused = 0;
  const box = await pairedStore([], {
    'sessions.clear': () => ({}),
    'sessions.rename': () => ({}),
    'sessions.restart': () => ({}),
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

test('the menu opens from a menu button and offers rename, spec, clear, archive and delete', async () => {
  const { wrapper, calls, store } = await setup();
  const trigger = wrapper.find('button[aria-haspopup="menu"]');
  expect(trigger.attributes('aria-expanded')).toBe('false');
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  await trigger.trigger('click');
  expect(trigger.attributes('aria-expanded')).toBe('true');
  expect(wrapper.findAll('[role="menuitem"]').map((b) => b.text())).toEqual([
    'Rename…',
    'Model & effort…',
    'Clear context',
    'Archive',
    'Delete…',
  ]);
  await wrapper.findAll('[role="menuitem"]')[2]?.trigger('click');
  await until(() => calls('sessions.clear').length === 1);
  expect(calls('sessions.clear')).toEqual([{ session: 's1' }]);
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  await settled(wrapper);
  expect(wrapper.emitted('closed')).toBeUndefined();
  await trigger.trigger('click');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: escape }));
  await flushPromises();
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  await trigger.trigger('click');
  await wrapper.findAll('[role="menuitem"]')[3]?.trigger('click');
  await until(() => calls('sessions.archive').length === 1);
  expect(calls('sessions.archive')).toEqual([{ session: 's1' }]);
  await settled(wrapper);
  expect(wrapper.emitted('closed')).toEqual([[]]);
  store.stop();
});

test('delete confirms what to remove; a dirty refusal asks again before discarding', async () => {
  const { wrapper, calls, store } = await setup(1);
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[4]?.trigger('click');
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

// Escape closes either form from wherever the focus is (useEscape: the document), consumed so
// the session screen's Esc (stop the agent) lets it pass.
const pressEscape = (): KeyboardEvent => {
  const key = new KeyboardEvent('keydown', { key: escape, cancelable: true });
  document.dispatchEvent(key);
  return key;
};

test('cancel or Escape closes the confirm without a call', async () => {
  const { wrapper, calls, store } = await setup();
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[4]?.trigger('click');
  expect(wrapper.find('form.confirm').exists()).toBe(true);
  await wrapper.find('form.confirm button.secondary').trigger('click');
  expect(wrapper.find('form.confirm').exists()).toBe(false);
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[4]?.trigger('click');
  const key = pressEscape();
  await flushPromises();
  expect(wrapper.find('form.confirm').exists()).toBe(false);
  expect(key.defaultPrevented).toBe(true);
  expect(calls('sessions.archive')).toEqual([]);
  store.stop();
});

test('rename shows the current title, refuses a blank one, and sends the trimmed one', async () => {
  const { wrapper, calls, store } = await setup();
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[0]?.trigger('click');
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  const input = wrapper.find<HTMLInputElement>('form.rename input');
  expect(input.element.value).toBe('First');
  expect(input.attributes('maxlength')).toBe('200');
  await input.setValue('   ');
  expect(wrapper.find('form.rename button[type="submit"]').attributes('disabled')).toBeDefined();
  await wrapper.find('form.rename').trigger('submit');
  expect(calls('sessions.rename')).toEqual([]);
  await input.setValue('  Second  ');
  await wrapper.find('form.rename').trigger('submit');
  await until(() => calls('sessions.rename').length === 1);
  expect(calls('sessions.rename')).toEqual([{ session: 's1', title: 'Second' }]);
  await settled(wrapper);
  expect(wrapper.find('form.rename').exists()).toBe(false);
  expect(wrapper.emitted('closed')).toBeUndefined();
  store.stop();
});

test('cancel or Escape closes the rename form without a call; opening delete closes it too', async () => {
  const { wrapper, calls, store } = await setup();
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[0]?.trigger('click');
  await wrapper.find('form.rename button.secondary').trigger('click');
  expect(wrapper.find('form.rename').exists()).toBe(false);
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[0]?.trigger('click');
  const key = pressEscape();
  await flushPromises();
  expect(wrapper.find('form.rename').exists()).toBe(false);
  expect(key.defaultPrevented).toBe(true);
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[0]?.trigger('click');
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[4]?.trigger('click');
  expect(wrapper.find('form.rename').exists()).toBe(false);
  expect(wrapper.find('form.confirm').exists()).toBe(true);
  expect(calls('sessions.rename')).toEqual([]);
  // The confirm is still open: unmounted so its Escape closer does not outlive the test.
  wrapper.unmount();
  store.stop();
});

// A box whose list carries a configured pair, which the sheet then starts from.
const specBox = async () =>
  pairedStore([], {
    'sessions.restart': () => ({}),
    'sessions.list': () => [
      {
        session: 's1',
        title: 'First',
        repo: '/repos/r',
        branch: 'flux/one',
        harness: 'claude',
        state: 'idle',
        lastSeq: 0,
        updatedAt: '2026-01-01T00:00:00Z',
        model: 'opus',
        effort: 'high',
      },
    ],
  });

const openSheet = async (wrapper: ReturnType<typeof mount>): Promise<void> => {
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[1]?.trigger('click');
};

const specInputs = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll<HTMLInputElement>('form.spec input').map((i) => i.element.value);

// The sheet sends only what the operator changed: absent keeps, null clears, a string sets.
test('model & effort starts empty on a box default, sends the change trimmed and restarts', async () => {
  const box = await specBox();
  const wrapper = mount(SessionMenu, { props: { store: box.store, session: 's1' } });
  await openSheet(wrapper);
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  const inputs = wrapper.findAll<HTMLInputElement>('form.spec input');
  expect(specInputs(wrapper)).toEqual(['', '']);
  expect(inputs.map((i) => i.attributes('placeholder'))).toEqual(['box default', 'box default']);
  expect(wrapper.find('form.spec button[type="submit"]').text()).toBe('Restart');
  await inputs[0]?.setValue(' sonnet ');
  await wrapper.find('form.spec').trigger('submit');
  await until(() => box.calls('sessions.restart').length === 1);
  expect(box.calls('sessions.restart')).toEqual([{ session: 's1', model: 'sonnet' }]);
  await settled(wrapper);
  expect(wrapper.find('form.spec').exists()).toBe(false);
  // The list refreshed carries the box's configured pair.
  expect(box.store.state.sessions[0]).toMatchObject({ model: 'opus', effort: 'high' });
  box.store.stop();
});

test('model & effort starts as configured; emptied clears, untouched is a plain restart', async () => {
  const box = await specBox();
  const wrapper = mount(SessionMenu, { props: { store: box.store, session: 's1' } });
  await box.store.restartSession('s1', {});
  await until(() => box.store.state.sessions[0]?.model === 'opus');
  await openSheet(wrapper);
  expect(specInputs(wrapper)).toEqual(['opus', 'high']);
  await wrapper.findAll<HTMLInputElement>('form.spec input')[1]?.setValue('');
  await wrapper.find('form.spec').trigger('submit');
  await until(() => box.calls('sessions.restart').length === 2);
  expect(box.calls('sessions.restart')[1]).toEqual({ session: 's1', effort: null });
  await settled(wrapper);
  await openSheet(wrapper);
  await wrapper.find('form.spec').trigger('submit');
  await until(() => box.calls('sessions.restart').length === 3);
  expect(box.calls('sessions.restart')[2]).toEqual({ session: 's1' });
  await settled(wrapper);
  box.store.stop();
});

test('cancel or Escape closes the model & effort sheet without a call', async () => {
  const { wrapper, calls, store } = await setup();
  await openSheet(wrapper);
  await wrapper.find('form.spec button.secondary').trigger('click');
  expect(wrapper.find('form.spec').exists()).toBe(false);
  await openSheet(wrapper);
  const key = pressEscape();
  await flushPromises();
  expect(wrapper.find('form.spec').exists()).toBe(false);
  expect(key.defaultPrevented).toBe(true);
  expect(calls('sessions.restart')).toEqual([]);
  store.stop();
});
