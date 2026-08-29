import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import GitActions from './GitActions.vue';

const commit = { sha: 'abcdef0123456789', subject: 'latest', author: 'me', ts: 't' };

test('commits all or the selected files, refreshes the log, and emits done', async () => {
  const box = await pairedStore([], {
    'git.log': () => ({ commits: [commit] }),
    'git.commit': () => ({ sha: 'abc' }),
  });
  const wrapper = mount(GitActions, {
    props: { store: box.store, session: 's1', selected: [] },
  });
  await until(() => Reflect.get(wrapper.vm, 'last') !== null);
  await flushPromises();
  expect(wrapper.find('.last').text()).toBe('abcdef0 latest');
  expect(wrapper.find('.commit').text()).toBe('Commit all');
  expect(wrapper.find('.commit').attributes('disabled')).toBeDefined();
  await wrapper.find('#commit-message').setValue('  first  ');
  expect(wrapper.find('.commit').attributes('disabled')).toBeUndefined();
  await wrapper.find('.commit').trigger('click');
  await until(() => box.calls('git.log').length === 2);
  await until(() => Reflect.get(wrapper.vm, 'busy') === null);
  await flushPromises();
  expect(box.calls('git.commit')).toEqual([{ session: 's1', message: 'first' }]);
  expect(wrapper.emitted('done')).toEqual([[]]);
  expect(Reflect.get(wrapper.vm, 'message')).toBe('');
  await wrapper.setProps({ selected: [{ path: 'a.ts' }, { path: 'b.ts', from: 'old.ts' }] });
  expect(wrapper.find('.commit').text()).toBe('Commit 2 selected');
  await wrapper.find('#commit-message').setValue('two');
  await wrapper.find('.commit').trigger('click');
  await until(() => box.calls('git.commit').length === 2);
  expect(box.calls('git.commit')[1]).toEqual({
    session: 's1',
    message: 'two',
    paths: ['a.ts', 'b.ts', 'old.ts'],
  });
  box.store.stop();
});

test('pushes, and shows a failure inline and in the status bar', async () => {
  const box = await pairedStore([], {
    'git.log': () => ({ commits: [] }),
    'git.push': () => ({ remote: 'origin', branch: 'flux/one' }),
  });
  const wrapper = mount(GitActions, {
    props: { store: box.store, session: 's1', selected: [] },
  });
  await until(() => box.calls('git.log').length === 1);
  await wrapper.find('.push').trigger('click');
  await until(() => box.calls('git.log').length === 2);
  await until(() => Reflect.get(wrapper.vm, 'busy') === null);
  expect(box.calls('git.push')).toEqual([{ session: 's1' }]);
  expect(wrapper.emitted('done')).toEqual([[]]);
  await wrapper.find('#commit-message').setValue('x');
  await wrapper.find('.commit').trigger('click');
  await until(() => Reflect.get(wrapper.vm, 'failure') !== null);
  await flushPromises();
  expect(wrapper.find('.error').text()).toBe('no git.commit');
  expect(box.store.state.error).toBe('no git.commit');
  expect(wrapper.emitted('done')).toHaveLength(1);
  box.store.stop();
});

test('opens a PR with the session title prefilled and links to the result', async () => {
  const box = await pairedStore([], {
    'git.log': () => ({ commits: [] }),
    'git.pr': (p) => ({ url: `https://github.com/o/r/pull/${p.draft}` }),
  });
  const wrapper = mount(GitActions, {
    props: { store: box.store, session: 's1', selected: [] },
  });
  await until(() => box.calls('git.log').length === 1);
  await flushPromises();
  const titleInput = wrapper.find<HTMLInputElement>('#pr-title');
  expect(titleInput.element.value).toBe('First');
  await titleInput.setValue('Ship it');
  await wrapper.find('#pr-body').setValue('  Because.  ');
  await wrapper.find('.draft input').setValue(true);
  await wrapper.find('.open-pr').trigger('click');
  await until(() => Reflect.get(wrapper.vm, 'prUrl') !== null);
  await flushPromises();
  expect(box.calls('git.pr')).toEqual([
    { session: 's1', title: 'Ship it', body: 'Because.', draft: true },
  ]);
  const link = wrapper.find('.url a');
  expect(link.attributes('href')).toBe('https://github.com/o/r/pull/true');
  expect(link.text()).toBe('https://github.com/o/r/pull/true');
  box.store.stop();
});
