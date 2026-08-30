import type { FileContent } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import type { PairedStore } from '../../test/paired-store.ts';
import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { ClientError } from '../client/client-error.ts';
import type { CodeEditor } from '../editor/create-code-editor.ts';
import EditView from './EditView.vue';

type Wrapper = ReturnType<typeof mount<typeof EditView>>;

const open = (box: PairedStore, path = 'src/a.ts'): Wrapper =>
  mount(EditView, {
    props: { store: box.store, session: 's1', path, dir: null },
    attachTo: document.body,
  });

// The editor is created after the file arrives, and its module is loaded on demand.
const loaded = async (wrapper: Wrapper): Promise<void> => {
  await until(() => Reflect.get(wrapper.vm, 'loading') === false);
  await flushPromises();
};

const ready = async (wrapper: Wrapper): Promise<void> => {
  await loaded(wrapper);
  await until(() => Reflect.get(wrapper.vm, 'editor') !== null);
};

// The component exposes its editor so tests can type through it.
const editorOf = (wrapper: Wrapper): CodeEditor => {
  const editor: CodeEditor = Reflect.get(wrapper.vm, 'editor');
  return editor;
};

const type = async (wrapper: Wrapper, text: string): Promise<void> => {
  editorOf(wrapper).insert(text);
  await flushPromises();
};

// Two ways the box can answer a write; the conflict test swaps between them.
const refuse = (): never => {
  throw new ClientError('conflict', 'a.ts changed since it was read');
};
const accept = (p: { content: string }): { hash: string } => ({ hash: `saved:${p.content}` });

const file = (content: string, hash = 'h1'): FileContent => ({
  content,
  binary: false,
  hash,
  truncated: false,
});

test('loads the file, saves with the hash it was read with, and clears the dirty mark', async () => {
  const box = await pairedStore([], {
    'fs.read': () => file('a\nb\n'),
    'fs.write': () => ({ hash: 'h2' }),
  });
  const wrapper = open(box);
  await ready(wrapper);
  expect(box.calls('fs.read')).toEqual([{ session: 's1', path: 'src/a.ts' }]);
  expect(wrapper.find('.editor').element.shadowRoot?.querySelector('.cm-content')).not.toBeNull();
  expect(wrapper.find('.dirty').exists()).toBe(false);
  expect(wrapper.find('.save').attributes('disabled')).toBeDefined();
  await type(wrapper, 'x');
  expect(wrapper.find('.dirty').exists()).toBe(true);
  expect(wrapper.find('.save').attributes('disabled')).toBeUndefined();
  await wrapper.find('.save').trigger('click');
  await until(() => box.calls('fs.write').length === 1);
  await until(() => Reflect.get(wrapper.vm, 'dirty') === false);
  expect(box.calls('fs.write')).toEqual([
    { session: 's1', path: 'src/a.ts', content: 'xa\nb\n', ifMatch: 'h1' },
  ]);
  expect(wrapper.find('.dirty').exists()).toBe(false);
  expect(box.store.state.drafts).toEqual({});
  await type(wrapper, 'y');
  await wrapper.find('.save').trigger('click');
  await until(() => box.calls('fs.write').length === 2);
  expect(box.calls('fs.write')[1]).toMatchObject({ ifMatch: 'h2' });
  wrapper.unmount();
  box.store.stop();
});

test('a CRLF file keeps its line endings through an edit', async () => {
  const box = await pairedStore([], {
    'fs.read': () => file('one\r\ntwo\r\n'),
    'fs.write': () => ({ hash: 'h2' }),
  });
  const wrapper = open(box);
  await ready(wrapper);
  expect(editorOf(wrapper).doc()).toBe('one\ntwo\n');
  expect(wrapper.find('.dirty').exists()).toBe(false);
  await type(wrapper, 'x\n');
  await wrapper.find('.save').trigger('click');
  await until(() => box.calls('fs.write').length === 1);
  expect(box.calls('fs.write')[0]).toMatchObject({ content: 'x\r\none\r\ntwo\r\n' });
  wrapper.unmount();
  box.store.stop();
});

test('typing during a save stays dirty; discard returns to the saved text', async () => {
  const box = await pairedStore([], {
    'fs.read': () => file('a'),
    'fs.write': () => ({ hash: 'h2' }),
  });
  const wrapper = open(box);
  await ready(wrapper);
  // The fake box has received the write (recorded synchronously) but its encrypted reply
  // still has to cross the channel, so this keystroke lands while the save is in flight.
  await type(wrapper, 'x');
  await wrapper.find('.save').trigger('click');
  await until(() => box.calls('fs.write').length === 1);
  expect(Reflect.get(wrapper.vm, 'saving')).toBe(true);
  await type(wrapper, 'y');
  await until(() => Reflect.get(wrapper.vm, 'saving') === false);
  await flushPromises();
  expect(editorOf(wrapper).doc()).toBe('xya');
  expect(wrapper.find('.dirty').exists()).toBe(true);
  expect(box.store.state.drafts['s1\0src/a.ts']).toEqual({ hash: 'h2', text: 'xya' });
  await wrapper.find('.discard').trigger('click');
  expect(editorOf(wrapper).doc()).toBe('xa');
  expect(wrapper.find('.dirty').exists()).toBe(false);
  wrapper.unmount();
  box.store.stop();
});

test('a conflict keeps the edits; reload takes the box version, overwrite forces ours', async () => {
  let content = 'one\n';
  let write: (p: { content: string }) => { hash: string } = refuse;
  const box = await pairedStore([], {
    'fs.read': () => file(content, content),
    'fs.write': (p) => write(p),
  });
  const wrapper = open(box);
  await ready(wrapper);
  await type(wrapper, 'mine ');
  await wrapper.find('.save').trigger('click');
  await until(() => Reflect.get(wrapper.vm, 'conflict') === true);
  await flushPromises();
  expect(wrapper.find('.conflict').text()).toContain('Changed on the box');
  expect(editorOf(wrapper).doc()).toBe('mine one\n');
  expect(wrapper.find('.save').attributes('disabled')).toBeDefined();
  expect(box.store.state.error).toBeNull();
  write = accept;
  await wrapper.find('.overwrite').trigger('click');
  await until(() => box.calls('fs.write').length === 2);
  await until(() => Reflect.get(wrapper.vm, 'conflict') === false);
  expect(box.calls('fs.write')[1]).toEqual({
    session: 's1',
    path: 'src/a.ts',
    content: 'mine one\n',
  });
  expect(wrapper.find('.dirty').exists()).toBe(false);
  write = refuse;
  await type(wrapper, 'more ');
  await wrapper.find('.save').trigger('click');
  await until(() => Reflect.get(wrapper.vm, 'conflict') === true);
  content = 'theirs\n';
  await wrapper.find('.conflict .secondary').trigger('click');
  await until(() => box.calls('fs.read').length === 2);
  await loaded(wrapper);
  expect(wrapper.find('.conflict').exists()).toBe(false);
  expect(editorOf(wrapper).doc()).toBe('theirs\n');
  expect(wrapper.find('.dirty').exists()).toBe(false);
  wrapper.unmount();
  box.store.stop();
});

test('a truncated file is read-only with a notice, a binary file is refused', async () => {
  const files: Record<string, FileContent> = {
    'big.log': { content: 'partial', binary: false, hash: 'h', truncated: true },
    'img.png': { content: '', binary: true, hash: 'h', truncated: false },
  };
  const box = await pairedStore([], {
    'fs.read': (p) => files[p.path] as FileContent,
  });
  const big = open(box, 'big.log');
  await ready(big);
  expect(big.find('.banner').text()).toContain('read-only');
  const content = big.find('.editor').element.shadowRoot?.querySelector('.cm-content');
  expect(content?.getAttribute('contenteditable')).toBe('false');
  // The save shortcut is gated the same way as the button.
  content?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));
  content?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  await flushPromises();
  expect(box.calls('fs.write')).toEqual([]);
  big.unmount();
  const image = open(box, 'img.png');
  await loaded(image);
  expect(image.find('.notice').text()).toBe('Binary or non-UTF-8 file.');
  image.unmount();
  box.store.stop();
});

test('leaving keeps a draft that comes back for the same file version, and warns on unload', async () => {
  let hash = 'h1';
  const box = await pairedStore([], { 'fs.read': () => file('a', hash) });
  const first = open(box);
  await ready(first);
  await first.find('.toolbar button').trigger('click');
  expect(first.emitted('back')).toEqual([[]]);
  await type(first, 'z');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  first.unmount();
  expect(box.store.state.drafts['s1\0src/a.ts']).toEqual({ hash: 'h1', text: 'za' });
  const after = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  const second = open(box);
  await ready(second);
  expect(editorOf(second).doc()).toBe('za');
  expect(second.find('.dirty').exists()).toBe(true);
  expect(second.find('.banner').text()).toBe('Unsaved edits restored.');
  second.unmount();
  // The box moved on: the draft was typed over an older version, is dropped, and says so.
  hash = 'h9';
  const third = open(box);
  await ready(third);
  expect(editorOf(third).doc()).toBe('a');
  expect(third.find('.dirty').exists()).toBe(false);
  expect(third.find('.banner').text()).toContain('Older unsaved edits were dropped');
  expect(box.store.state.drafts).toEqual({});
  third.unmount();
  box.store.stop();
});

test('a file opened from the browser labels its back button Files', async () => {
  const box = await pairedStore([], { 'fs.read': () => file('a\n') });
  const wrapper = mount(EditView, {
    props: { store: box.store, session: 's1', path: 'src/a.ts', dir: 'src' },
    attachTo: document.body,
  });
  await loaded(wrapper);
  expect(wrapper.find('.toolbar button').text()).toBe('‹ Files');
  await wrapper.find('.toolbar button').trigger('click');
  expect(wrapper.emitted('back')).toEqual([[]]);
  wrapper.unmount();
  box.store.stop();
});

test('a read that fails is shown in place', async () => {
  const box = await pairedStore([]);
  const wrapper = open(box, 'missing.ts');
  await loaded(wrapper);
  expect(wrapper.find('.notice').text()).toBe('no fs.read');
  wrapper.unmount();
  box.store.stop();
});
