import { mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';

import MessageMenu from './MessageMenu.vue';

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

test('reply is emitted and the menu sits on the given side', async () => {
  const wrapper = mount(MessageMenu, { props: { text: 'x', side: 'left' } });
  expect(wrapper.find('.menu-root').classes()).toContain('left');
  await wrapper.find('.trigger').trigger('click');
  await wrapper.findAll('[role="menuitem"]')[1]?.trigger('click');
  expect(wrapper.emitted('reply')).toHaveLength(1);
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
});
