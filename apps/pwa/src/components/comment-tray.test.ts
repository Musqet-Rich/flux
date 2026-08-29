import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import CommentTray from './CommentTray.vue';

test('shows where each pending comment points and emits remove', async () => {
  const comments = [
    {
      commentId: 'a',
      ref: { path: 'x.ts', rev: 'worktree', range: { startLine: 3, endLine: 3 } },
      text: 'one',
    },
    {
      commentId: 'b',
      ref: { path: 'y.ts', rev: 'worktree', range: { startLine: 1, endLine: 4 } },
      text: 'two',
    },
    { commentId: 'c', ref: { path: 'z.ts', rev: 'worktree' }, text: 'three' },
  ];
  const wrapper = mount(CommentTray, { props: { comments } });
  expect(wrapper.findAll('.where').map((w) => w.text())).toEqual(['x.ts:3', 'y.ts:1–4', 'z.ts']);
  expect(wrapper.findAll('.text').map((w) => w.text())).toEqual(['one', 'two', 'three']);
  await wrapper.findAll('button.remove')[1]?.trigger('click');
  expect(wrapper.emitted('remove')).toEqual([['b']]);
});

test('renders nothing without comments', () => {
  const wrapper = mount(CommentTray, { props: { comments: [] } });
  expect(wrapper.find('.tray').exists()).toBe(false);
});
