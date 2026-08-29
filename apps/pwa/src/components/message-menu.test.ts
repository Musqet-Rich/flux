import { flushPromises, mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';
import { nextTick } from 'vue';

import MessageMenu from './MessageMenu.vue';

const escape = 'Escape';
const clipboard = (): { writeText: ReturnType<typeof vi.fn> } => {
  const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return { writeText };
};

test('copy puts the raw text on the clipboard and closes the menu', async () => {
  const { writeText } = clipboard();
  const wrapper = mount(MessageMenu, { props: { text: '## raw *md*', side: 'right' } });
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  await wrapper.find('.trigger').trigger('click');
  expect(wrapper.find('[role="menu"]').exists()).toBe(true);
  await wrapper.find('[role="menuitem"]').trigger('click');
  expect(writeText).toHaveBeenCalledWith('## raw *md*');
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  expect(wrapper.find('.trigger').classes()).toContain('copied');
});

test('copy without a clipboard (plain http) reports failure instead of throwing', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  const wrapper = mount(MessageMenu, { props: { text: 'x', side: 'right' } });
  await wrapper.find('.trigger').trigger('click');
  await wrapper.find('[role="menuitem"]').trigger('click');
  await flushPromises();
  expect(wrapper.find('.trigger').classes()).toContain('failed');
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
});

test('Escape and a tap outside close the menu; a tap inside does not', async () => {
  const wrapper = mount(MessageMenu, {
    props: { text: 'x', side: 'right' },
    attachTo: document.body,
  });
  await wrapper.find('.trigger').trigger('click');
  wrapper.find('.menu').element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await nextTick();
  expect(wrapper.find('[role="menu"]').exists()).toBe(true);
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await nextTick();
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  await wrapper.find('.trigger').trigger('click');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: escape }));
  await nextTick();
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  wrapper.unmount();
});

test('reply is emitted and the menu sits on the given side', async () => {
  const wrapper = mount(MessageMenu, { props: { text: 'x', side: 'left' } });
  expect(wrapper.find('.menu-root').classes()).toContain('left');
  await wrapper.find('.trigger').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[1]?.trigger('click');
  expect(wrapper.emitted('reply')).toHaveLength(1);
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
});
