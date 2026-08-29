import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import MessageAttachments from './MessageAttachments.vue';

const image = { id: 'a1', name: 'shot.png', mime: 'image/png', size: 75, image: true };
const text = { id: 'a2', name: 'notes.txt', mime: 'text/plain', size: 15 * 1024, image: false };

test('an image with a fetched thumbnail shows it, opening full-size on tap; others show name and size', async () => {
  const wrapper = mount(MessageAttachments, {
    props: { attachments: [image, text], thumbs: { a1: 'blob:thumb' } },
  });
  const img = wrapper.find('.image img');
  expect(img.attributes('src')).toBe('blob:thumb');
  expect(img.attributes('alt')).toBe('shot.png');
  expect(wrapper.find('.plain .name').text()).toBe('notes.txt');
  expect(wrapper.find('.plain .size').text()).toBe('15.0 KiB');
  expect(wrapper.find('.overlay').exists()).toBe(false);
  await wrapper.find('.image').trigger('click');
  expect(wrapper.find('.overlay img').attributes('src')).toBe('blob:thumb');
  await wrapper.find('.overlay .close').trigger('click');
  expect(wrapper.find('.overlay').exists()).toBe(false);
  await wrapper.find('.image').trigger('click');
  await wrapper.find('.overlay').trigger('click');
  expect(wrapper.find('.overlay').exists()).toBe(false);
});

test('an image whose thumbnail is not fetched yet shows as a file', () => {
  const wrapper = mount(MessageAttachments, { props: { attachments: [image], thumbs: {} } });
  expect(wrapper.find('.image').exists()).toBe(false);
  expect(wrapper.find('.plain .name').text()).toBe('shot.png');
});
