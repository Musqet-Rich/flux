import type { VueWrapper } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import Composer from './Composer.vue';

// Files reach the composer three ways, the file input, a drop on the bar and a paste, and
// each puts a chip above the box; Send waits for every upload; × takes a file off.

const png = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
const txt = new File(['hi'], 'notes.txt', { type: 'text/plain' });

const setup = async () => {
  const box = await pairedStore([], {
    'attach.begin': (p) => ({ attachmentId: `id-${p.name}` }),
    'attach.chunk': () => ({}),
    'attach.end': (p) => ({ path: `/box/${p.attachmentId}`, size: 0 }),
    'attach.delete': () => ({}),
    'agent.send': () => ({ seq: 2 }),
  });
  const wrapper = mount(Composer, {
    props: { store: box.store, session: 's1', events: [], reply: null },
    attachTo: document.body,
  });
  return { ...box, wrapper };
};

const chips = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.chip .name').map((n) => n.text());

const withFiles = (type: string, field: 'dataTransfer' | 'clipboardData', files: File[]): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, field, { value: { files, types: ['Files'], dropEffect: '' } });
  return event;
};

test('the + button, a drop on the bar and a paste each add a chip; send waits for uploads', async () => {
  const { store, wrapper, calls } = await setup();
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [png], configurable: true });
  await input.trigger('change');
  expect(chips(wrapper)).toEqual(['shot.png']);
  expect(wrapper.find('.chip img').attributes('src')).toMatch(/^blob:/u);
  wrapper.find('.composer').element.dispatchEvent(withFiles('drop', 'dataTransfer', [txt]));
  await wrapper.vm.$nextTick();
  expect(chips(wrapper)).toEqual(['shot.png', 'notes.txt']);
  expect(wrapper.find('.chip .icon').exists()).toBe(true);
  const paste = withFiles('paste', 'clipboardData', [png]);
  wrapper.find('textarea').element.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);
  await wrapper.vm.$nextTick();
  expect(chips(wrapper)).toEqual(['shot.png', 'notes.txt', 'shot.png']);
  const textPaste = withFiles('paste', 'clipboardData', []);
  wrapper.find('textarea').element.dispatchEvent(textPaste);
  expect(textPaste.defaultPrevented).toBe(false);
  await wrapper.find('textarea').setValue('see these');
  await until(() => store.composer('s1').attachments.every((a) => a.status === 'ready'));
  await wrapper.vm.$nextTick();
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
  await wrapper.find('form.row').trigger('submit');
  await until(() => calls('agent.send').length === 1);
  expect(calls('agent.send')).toEqual([
    {
      session: 's1',
      text: 'see these',
      attachments: ['id-shot.png', 'id-notes.txt', 'id-shot.png'],
    },
  ]);
  await until(() => store.composer('s1').attachments.length === 0);
  await wrapper.vm.$nextTick();
  expect(chips(wrapper)).toEqual([]);
  expect(wrapper.find('textarea').element.value).toBe('');
  wrapper.unmount();
  store.stop();
});

test('send is disabled while a file uploads; × removes a chip and deletes it on the box', async () => {
  const { store, wrapper, calls } = await setup();
  store.attach('s1', [txt]);
  await wrapper.find('textarea').setValue('wait');
  const draft = store.composer('s1');
  expect(draft.attachments[0]?.status).toBe('uploading');
  expect(wrapper.find('.chip progress').exists()).toBe(true);
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();
  await until(() => draft.attachments[0]?.status === 'ready');
  await wrapper.vm.$nextTick();
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
  await wrapper.find('.chip .remove').trigger('click');
  expect(chips(wrapper)).toEqual([]);
  await until(() => calls('attach.delete').length === 1);
  expect(calls('attach.delete')).toEqual([{ attachmentId: 'id-notes.txt' }]);
  expect(store.composer('s1').text).toBe('wait');
  wrapper.unmount();
  store.stop();
});

test('the draft text and files survive a remount of the composer', async () => {
  const { store, wrapper } = await setup();
  await wrapper.find('textarea').setValue('draft');
  store.attach('s1', [txt]);
  wrapper.unmount();
  const again = mount(Composer, {
    props: { store, session: 's1', events: [], reply: null },
  });
  expect(again.find('textarea').element.value).toBe('draft');
  expect(chips(again)).toEqual(['notes.txt']);
  again.unmount();
  store.stop();
});
