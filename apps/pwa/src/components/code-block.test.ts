import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import CodeBlock from './CodeBlock.vue';

// A fenced block's Copy: puts the body on the clipboard and shows a tick, a cross when the
// clipboard is missing, and no button at all while the fence is still open.

const clipboard = (): { writeText: ReturnType<typeof vi.fn> } => {
  const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return { writeText };
};

// The reset timer runs under fake time, and the clipboard each test installs is taken away
// again, so no test leans on another's.
const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  if (original === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
  else Object.defineProperty(navigator, 'clipboard', original);
});

test('copy puts the fence body on the clipboard and shows a tick for a moment', async () => {
  const { writeText } = clipboard();
  const wrapper = mount(CodeBlock, { props: { text: 'let a\nlet b', lang: 'ts', closed: true } });
  expect(wrapper.find('pre > code.language-ts').text()).toBe('let a\nlet b');
  expect(wrapper.find('.copy svg').attributes('data-icon')).toBe('copy');
  await wrapper.find('.copy').trigger('click');
  await flushPromises();
  expect(writeText).toHaveBeenCalledWith('let a\nlet b');
  expect(wrapper.find('.copy').classes()).toContain('copied');
  expect(wrapper.find('.copy svg').attributes('data-icon')).toBe('check');
  expect(wrapper.find('[role="status"]').text()).toBe('Copied');
  vi.advanceTimersByTime(1500);
  await flushPromises();
  expect(wrapper.find('.copy svg').attributes('data-icon')).toBe('copy');
  expect(wrapper.find('[role="status"]').text()).toBe('');
});

test('a second tap restarts the moment rather than being cut short by the first', async () => {
  clipboard();
  const wrapper = mount(CodeBlock, { props: { text: 'x', lang: '', closed: true } });
  await wrapper.find('.copy').trigger('click');
  await flushPromises();
  vi.advanceTimersByTime(1400);
  await wrapper.find('.copy').trigger('click');
  await flushPromises();
  vi.advanceTimersByTime(1400);
  await flushPromises();
  expect(wrapper.find('.copy svg').attributes('data-icon')).toBe('check');
  vi.advanceTimersByTime(100);
  await flushPromises();
  expect(wrapper.find('.copy svg').attributes('data-icon')).toBe('copy');
});

test('copy without a clipboard (plain http) shows a cross instead of throwing', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  const wrapper = mount(CodeBlock, { props: { text: 'x', lang: '', closed: true } });
  await wrapper.find('.copy').trigger('click');
  await flushPromises();
  expect(wrapper.find('.copy').classes()).toContain('failed');
  expect(wrapper.find('.copy svg').attributes('data-icon')).toBe('failed');
  expect(wrapper.find('[role="status"]').text()).toBe('Copy failed');
});

test('an open fence has no button, no status region and no language class', () => {
  const wrapper = mount(CodeBlock, { props: { text: 'half', lang: '', closed: false } });
  expect(wrapper.find('pre.open > code:not([class])').text()).toBe('half');
  expect(wrapper.find('.copy').exists()).toBe(false);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
});

test('an empty fence has nothing to copy, so no button', () => {
  const wrapper = mount(CodeBlock, { props: { text: '', lang: '', closed: true } });
  expect(wrapper.find('.copy').exists()).toBe(false);
});

test('the language names the button', () => {
  const wrapper = mount(CodeBlock, { props: { text: 'x', lang: 'sh', closed: true } });
  expect(wrapper.find('.copy').attributes('aria-label')).toBe('Copy sh code');
});
