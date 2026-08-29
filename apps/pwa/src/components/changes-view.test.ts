import { flushPromises, mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import ChangesView from './ChangesView.vue';

test('lists the worktree status, disables deleted files, and emits open and back', async () => {
  const box = await pairedStore([], {
    'git.status': () => ({
      files: [
        { path: 'src/a.ts', status: 'M' },
        { path: 'gone.ts', status: 'D' },
      ],
    }),
  });
  const wrapper = mount(ChangesView, { props: { store: box.store, session: 's1' } });
  await vi.waitFor(() => {
    expect(wrapper.findAll('.file').length).toBe(2);
  });
  expect(wrapper.find('.count').text()).toBe('2 changed');
  expect(wrapper.findAll('.path').map((p) => p.text())).toEqual(['src/a.ts', 'gone.ts']);
  expect(wrapper.findAll('.file')[1]?.attributes('disabled')).toBeDefined();
  await wrapper.find('.file').trigger('click');
  expect(wrapper.emitted('open')).toEqual([['src/a.ts']]);
  await wrapper.find('.toolbar button').trigger('click');
  expect(wrapper.emitted('back')).toEqual([[]]);
  box.store.stop();
});

test('falls back to the last files.changed event when git.status is unavailable', async () => {
  const box = await pairedStore([]);
  const changed = box.event(1, 'files.changed', { files: [{ path: 'x.ts', status: 'A' }] });
  const wrapper = mount(ChangesView, { props: { store: box.store, session: 's1' } });
  await box.relay.emit(changed);
  await vi.waitFor(() => {
    expect(wrapper.findAll('.path').map((p) => p.text())).toEqual(['x.ts']);
  });
  await flushPromises();
  expect(wrapper.find('.status').classes()).toContain('A');
  box.store.stop();
});
