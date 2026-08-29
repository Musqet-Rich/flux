import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import ChangesView from './ChangesView.vue';

test('lists the worktree status, disables deleted files, and emits open and back', async () => {
  const box = await pairedStore([], {
    'git.status': () => ({
      files: [
        { path: 'src/a.ts', status: 'M' },
        { path: 'new.ts', status: 'R', from: 'old.ts' },
        { path: 'gone.ts', status: 'D' },
      ],
    }),
  });
  const wrapper = mount(ChangesView, { props: { store: box.store, session: 's1' } });
  await until(() => box.calls('git.status').length === 1);
  await until(() => Reflect.get(wrapper.vm, 'loading') === false);
  await flushPromises();
  expect(wrapper.findAll('.file').length).toBe(3);
  expect(wrapper.find('.count').text()).toBe('3 changed');
  expect(wrapper.findAll('.path').map((p) => p.text())).toEqual(['src/a.ts', 'new.ts', 'gone.ts']);
  expect(wrapper.find('.from').text()).toBe('← old.ts');
  expect(wrapper.findAll('.status')[1]?.classes()).toContain('R');
  expect(wrapper.findAll('.file')[2]?.attributes('disabled')).toBeDefined();
  expect(wrapper.findAll('.edit')[2]?.attributes('disabled')).toBeDefined();
  await wrapper.find('.edit').trigger('click');
  expect(wrapper.emitted('edit')).toEqual([['src/a.ts']]);
  await wrapper.find('.file').trigger('click');
  await wrapper.findAll('.file')[1]?.trigger('click');
  expect(wrapper.emitted('open')).toEqual([
    ['src/a.ts', null],
    ['new.ts', 'old.ts'],
  ]);
  await wrapper.find('.toolbar button').trigger('click');
  expect(wrapper.emitted('back')).toEqual([[]]);
  box.store.stop();
});

test('ticked files narrow the commit, and a commit refreshes the list and clears ticks', async () => {
  let files = [
    { path: 'a.ts', status: 'M' as const },
    { path: 'b.ts', status: 'R' as const, from: 'old.ts' },
  ];
  const box = await pairedStore([], {
    'git.status': () => ({ files }),
    'git.log': () => ({ commits: [] }),
    'git.commit': () => ({ sha: 'abc' }),
  });
  const wrapper = mount(ChangesView, { props: { store: box.store, session: 's1' } });
  await until(() => Reflect.get(wrapper.vm, 'files').length === 2);
  await flushPromises();
  await wrapper.findAll('.pick')[1]?.setValue(true);
  expect(wrapper.find('.commit').text()).toBe('Commit 1 selected');
  files = [{ path: 'a.ts', status: 'M' as const }];
  await wrapper.find('#commit-message').setValue('only b');
  await wrapper.find('.commit').trigger('click');
  await until(() => Reflect.get(wrapper.vm, 'files').length === 1);
  await flushPromises();
  // A rename is one tick, two paths: the old one is the staged deletion.
  expect(box.calls('git.commit')).toEqual([
    { session: 's1', message: 'only b', paths: ['b.ts', 'old.ts'] },
  ]);
  expect(wrapper.findAll('.path').map((p) => p.text())).toEqual(['a.ts']);
  expect(Reflect.get(wrapper.vm, 'selected')).toEqual([]);
  expect(wrapper.find('.commit').text()).toBe('Commit all');
  box.store.stop();
});

test('a vcs.changed notice from the box refetches the status', async () => {
  let files = [{ path: 'a.ts', status: 'M' as const }];
  const box = await pairedStore([], { 'git.status': () => ({ files }) });
  const wrapper = mount(ChangesView, { props: { store: box.store, session: 's1' } });
  await until(() => box.calls('git.status').length === 1);
  await until(() => box.store.state.logs['s1'] !== undefined);
  files = [];
  await box.relay.ephemeral({ type: 'vcs.changed', session: 's1', kind: 'commit' });
  await until(() => box.calls('git.status').length === 2);
  await until(() => Reflect.get(wrapper.vm, 'loading') === false);
  await flushPromises();
  expect(wrapper.find('.empty').exists()).toBe(true);
  box.store.stop();
});

test('falls back to the last files.changed event when git.status is unavailable', async () => {
  const box = await pairedStore([]);
  const changed = box.event(1, 'files.changed', { files: [{ path: 'x.ts', status: 'A' }] });
  const wrapper = mount(ChangesView, { props: { store: box.store, session: 's1' } });
  await until(() => box.store.state.logs['s1'] !== undefined);
  await box.relay.emit(changed);
  await until(() => box.store.state.logs['s1']?.lastSeq === 1);
  await flushPromises();
  expect(wrapper.findAll('.path').map((p) => p.text())).toEqual(['x.ts']);
  expect(wrapper.find('.status').classes()).toContain('A');
  box.store.stop();
});
