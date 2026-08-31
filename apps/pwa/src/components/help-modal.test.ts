import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import HelpModal from './HelpModal.vue';

const helpSummary = (question: string) => ({
  session: 'help-1',
  title: question,
  repo: '/data/help',
  branch: 'help-abc123',
  harness: 'claude' as const,
  state: 'idle' as const,
  lastSeq: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const withHelp = () => pairedStore([], { 'sessions.createHelp': (p) => helpSummary(p.question) });

test('Send is disabled until the question has non-whitespace text', async () => {
  const box = await withHelp();
  const wrapper = mount(HelpModal, { props: { store: box.store } });
  const send = wrapper.findAll('button').find((b) => b.text() === 'Send');
  expect(send?.attributes('disabled')).toBeDefined();
  await wrapper.find('textarea').setValue('   ');
  expect(send?.attributes('disabled')).toBeDefined();
  await wrapper.find('textarea').setValue('How do I pair?');
  expect(send?.attributes('disabled')).toBeUndefined();
  box.store.stop();
});

test('focuses the textarea on open', async () => {
  const box = await withHelp();
  const wrapper = mount(HelpModal, { props: { store: box.store }, attachTo: document.body });
  expect(document.activeElement).toBe(wrapper.find('textarea').element);
  wrapper.unmount();
  box.store.stop();
});

test('Send opens a help session with the trimmed question and emits created', async () => {
  const box = await withHelp();
  const wrapper = mount(HelpModal, { props: { store: box.store } });
  await wrapper.find('textarea').setValue('  How do I pair a device?  ');
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'Send')
    ?.trigger('click');
  await until(() => box.store.state.sessions.some((s) => s.session === 'help-1'));
  await flushPromises();
  expect(box.calls('sessions.createHelp')).toEqual([{ question: 'How do I pair a device?' }]);
  expect(wrapper.emitted('created')?.[0]?.[0]).toMatchObject({ session: 'help-1' });
  box.store.stop();
});

// test-utils `trigger` does not set the system modifier keys, so dispatch a real KeyboardEvent
// (the pattern edit-view.test uses) to exercise ⌘/Ctrl-Enter.
const press = (el: Element, init: KeyboardEventInit): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
};

test('Cmd/Ctrl+Enter submits', async () => {
  const box = await withHelp();
  const wrapper = mount(HelpModal, { props: { store: box.store } });
  const ta = wrapper.find('textarea');
  const idle = (): Promise<void> => until(() => Reflect.get(wrapper.vm, 'busy') === false);
  await ta.setValue('go');
  press(ta.element, { key: 'Enter', metaKey: true });
  await until(() => box.calls('sessions.createHelp').length === 1);
  await idle();
  await ta.setValue('again');
  press(ta.element, { key: 'Enter', ctrlKey: true });
  await until(() => box.calls('sessions.createHelp').length === 2);
  expect(box.calls('sessions.createHelp')).toEqual([{ question: 'go' }, { question: 'again' }]);
  box.store.stop();
});

test('Escape and a backdrop tap close without submitting', async () => {
  const box = await withHelp();
  const esc = 'Escape';
  const first = mount(HelpModal, { props: { store: box.store } });
  await first.find('textarea').setValue('typed');
  await first.find('textarea').trigger('keydown', { key: esc });
  expect(first.emitted('close')).toHaveLength(1);
  expect(first.emitted('created')).toBeUndefined();

  const second = mount(HelpModal, { props: { store: box.store } });
  await second.find('.backdrop').trigger('click');
  expect(second.emitted('close')).toHaveLength(1);
  expect(box.calls('sessions.createHelp')).toHaveLength(0);
  box.store.stop();
});

test('an error keeps the modal open with the text intact and shows the message', async () => {
  const box = await pairedStore([]);
  const wrapper = mount(HelpModal, { props: { store: box.store } });
  await wrapper.find('textarea').setValue('why');
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'Send')
    ?.trigger('click');
  await until(() => Reflect.get(wrapper.vm, 'failure') !== null);
  await flushPromises();
  expect(wrapper.find('.error').text()).toBe('no sessions.createHelp');
  expect(wrapper.find<HTMLTextAreaElement>('textarea').element.value).toBe('why');
  expect(wrapper.emitted('created')).toBeUndefined();
  box.store.stop();
});
