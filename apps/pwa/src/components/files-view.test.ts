import type { DirEntry } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import type { PairedStore } from '../../test/paired-store.ts';
import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import FilesView from './FilesView.vue';

type Wrapper = ReturnType<typeof mount<typeof FilesView>>;

const mixed: DirEntry[] = [
  { name: 'z.ts', kind: 'file' },
  { name: 'lib', kind: 'dir' },
  { name: 'a.ts', kind: 'file' },
  { name: 'src', kind: 'dir' },
];

const open = (box: PairedStore, path = ''): Wrapper =>
  mount(FilesView, { props: { store: box.store, session: 's1', path } });

// The list appears once fs.list has answered.
const listed = async (wrapper: Wrapper): Promise<void> => {
  await until(() => Reflect.get(wrapper.vm, 'loading') === false);
  await flushPromises();
};

const names = (wrapper: Wrapper): string[] => wrapper.findAll('.name').map((n) => n.text());

test('lists a directory dirs-first then files, each alphabetical', async () => {
  const box = await pairedStore([], { 'fs.list': () => ({ entries: mixed }) });
  const wrapper = open(box);
  await listed(wrapper);
  expect(box.calls('fs.list')).toEqual([{ session: 's1', path: '' }]);
  expect(names(wrapper)).toEqual(['lib', 'src', 'a.ts', 'z.ts']);
  wrapper.unmount();
  box.store.stop();
});

test('tapping a directory asks to descend and re-lists the child on the new path', async () => {
  const listings: Record<string, DirEntry[]> = {
    '': [{ name: 'src', kind: 'dir' }],
    src: [{ name: 'main.ts', kind: 'file' }],
  };
  const box = await pairedStore([], {
    'fs.list': (p) => ({ entries: listings[p.path] as DirEntry[] }),
  });
  const wrapper = open(box);
  await listed(wrapper);
  await wrapper.find('.entry').trigger('click');
  expect(wrapper.emitted('enter')).toEqual([['src']]);
  await wrapper.setProps({ path: 'src' });
  await listed(wrapper);
  expect(box.calls('fs.list')).toEqual([
    { session: 's1', path: '' },
    { session: 's1', path: 'src' },
  ]);
  expect(names(wrapper)).toEqual(['main.ts']);
  wrapper.unmount();
  box.store.stop();
});

test('tapping a file opens it by its full path', async () => {
  const box = await pairedStore([], {
    'fs.list': () => ({ entries: [{ name: 'main.ts', kind: 'file' }] }),
  });
  const wrapper = open(box, 'src');
  await listed(wrapper);
  await wrapper.find('.entry').trigger('click');
  expect(wrapper.emitted('open')).toEqual([['src/main.ts']]);
  wrapper.unmount();
  box.store.stop();
});

test('the breadcrumb and back button walk up the tree', async () => {
  const box = await pairedStore([], { 'fs.list': () => ({ entries: [] }) });
  const wrapper = open(box, 'src/app');
  await listed(wrapper);
  await wrapper.find('.toolbar .secondary').trigger('click');
  expect(wrapper.emitted('enter')).toEqual([['src']]);
  const crumbs = wrapper.findAll('.crumb');
  expect(crumbs.map((c) => c.text())).toEqual(['/', 'src', 'app']);
  await crumbs.find((c) => c.text() === 'src')?.trigger('click');
  expect(wrapper.emitted('enter')).toEqual([['src'], ['src']]);
  wrapper.unmount();
  box.store.stop();
});

test('back at the worktree root leaves for the session', async () => {
  const box = await pairedStore([], { 'fs.list': () => ({ entries: [] }) });
  const wrapper = open(box);
  await listed(wrapper);
  await wrapper.find('.toolbar .secondary').trigger('click');
  expect(wrapper.emitted('back')).toEqual([[]]);
  expect(wrapper.emitted('enter')).toBeUndefined();
  wrapper.unmount();
  box.store.stop();
});

test('an empty directory says so and a failed listing shows a notice, not a crash', async () => {
  const empty = await pairedStore([], { 'fs.list': () => ({ entries: [] }) });
  const one = open(empty);
  await listed(one);
  expect(one.find('.empty').text()).toBe('Empty directory.');
  one.unmount();
  empty.store.stop();
  // No fs.list handler: the box refuses with `no fs.list`, which the view shows in place.
  const broken = await pairedStore([]);
  const two = open(broken, 'not-a-dir');
  await listed(two);
  expect(two.find('.notice').text()).toBe('no fs.list');
  expect(two.findAll('.entry')).toHaveLength(0);
  two.unmount();
  broken.store.stop();
});
