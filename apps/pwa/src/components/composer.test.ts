import type { Skill } from '@flux/protocol';
import type { VueWrapper } from '@vue/test-utils';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { fakeResizeObserver } from '../../test/fake-resize-observer.ts';
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
    props: { store: box.store, session: 's1', comments: [], reply: null },
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

// Slash-command autocomplete: the composer offers the box's skill names while the message is a
// single `/token`, and picking one inserts `/<name> `.
const withSkills = async (skills: Skill[]) => {
  const box = await pairedStore([], {
    'skills.list': () => ({ skills }),
    'agent.send': () => ({ seq: 2 }),
  });
  const wrapper = mount(Composer, {
    props: { store: box.store, session: 's1', comments: [], reply: null },
    attachTo: document.body,
  });
  await until(() => box.store.state.skills !== null);
  await flushPromises();
  return { ...box, wrapper };
};

const options = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.slash-option').map((o) => o.text());

test('a leading slash suggests skill names, filtered by what is typed, and a click inserts one', async () => {
  const { store, wrapper } = await withSkills([
    { name: 'review', body: '' },
    { name: 'deploy', body: '' },
  ]);
  await wrapper.find('textarea').setValue('/');
  expect(options(wrapper)).toEqual(['/review', '/deploy']);
  await wrapper.find('textarea').setValue('/re');
  expect(options(wrapper)).toEqual(['/review']);
  await wrapper.findAll('.slash-option')[0]?.trigger('mousedown');
  expect(wrapper.find('textarea').element.value).toBe('/review ');
  expect(wrapper.find('.slash-suggest').exists()).toBe(false);
  wrapper.unmount();
  store.stop();
});

test('arrow keys move the highlight, Enter takes it, Escape dismisses the list', async () => {
  const { store, wrapper } = await withSkills([
    { name: 'review', body: '' },
    { name: 'deploy', body: '' },
  ]);
  const press = (name: string): Promise<void> =>
    wrapper.find('textarea').trigger('keydown', { key: name });
  await wrapper.find('textarea').setValue('/');
  await press('ArrowDown');
  await press('Enter');
  expect(wrapper.find('textarea').element.value).toBe('/deploy ');
  await wrapper.find('textarea').setValue('/re');
  expect(wrapper.find('.slash-suggest').exists()).toBe(true);
  // Consumed, so the session screen's Esc (stop the agent) lets it pass.
  const escape = 'Escape';
  const esc = new KeyboardEvent('keydown', { key: escape, bubbles: true, cancelable: true });
  wrapper.find('textarea').element.dispatchEvent(esc);
  await flushPromises();
  expect(wrapper.find('.slash-suggest').exists()).toBe(false);
  expect(esc.defaultPrevented).toBe(true);
  wrapper.unmount();
  store.stop();
});

// test-utils `trigger` does not set the system modifier keys, so a chord is a real KeyboardEvent.
// A bare Enter is its keydown and then, when nothing cancelled it, the line break it produces.
const press = (el: Element, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  el.dispatchEvent(event);
  return event;
};
const breakLine = (el: Element): InputEvent => {
  const event = new InputEvent('beforeinput', {
    inputType: 'insertLineBreak',
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(event);
  return event;
};
const bareEnter = (el: Element, init: KeyboardEventInit = {}): InputEvent | null =>
  press(el, init).defaultPrevented ? null : breakLine(el);

test('the send key sends; every other Enter breaks the line', async () => {
  const { store, wrapper, calls } = await setup();
  const ta = wrapper.find('textarea');
  expect(wrapper.find('button[type="submit"]').attributes('title')).toBe('Send (Ctrl+Enter)');
  await ta.setValue('first');
  expect(bareEnter(ta.element)?.defaultPrevented).toBe(false);
  expect(bareEnter(ta.element, { shiftKey: true })?.defaultPrevented).toBe(false);
  expect(press(ta.element, { altKey: true }).defaultPrevented).toBe(true);
  await wrapper.vm.$nextTick();
  expect(ta.element.value).toBe('first\n');
  expect(calls('agent.send')).toEqual([]);
  press(ta.element, { ctrlKey: true });
  await until(() => calls('agent.send').length === 1);
  expect(calls('agent.send')).toEqual([{ session: 's1', text: 'first' }]);
  expect(wrapper.emitted('sent')).toHaveLength(1);
  // The box clears the draft once the message has landed; a send in flight ignores the key.
  await until(() => store.composer('s1').text === '');
  await store.setSendKey('enter');
  await wrapper.vm.$nextTick();
  expect(wrapper.find('button[type="submit"]').attributes('title')).toBe('Send (Enter)');
  await ta.setValue('second');
  press(ta.element, { metaKey: true });
  await wrapper.vm.$nextTick();
  expect(ta.element.value).toBe('second\n');
  expect(store.composer('s1').text).toBe('second\n');
  expect(bareEnter(ta.element)?.defaultPrevented).toBe(true);
  await until(() => calls('agent.send').length === 2);
  expect(calls('agent.send')[1]).toEqual({ session: 's1', text: 'second' });
  wrapper.unmount();
  store.stop();
});

test('a send chord that cannot send breaks the line instead of dying on the disabled button', async () => {
  const { store, wrapper, calls } = await setup();
  const ta = wrapper.find('textarea');
  await store.setSendKey('enter');
  // Blank: neither a bare Enter nor a chord puts anything in the draft.
  expect(bareEnter(ta.element)?.defaultPrevented).toBe(true);
  await store.setSendKey('meta');
  expect(press(ta.element, { metaKey: true }).defaultPrevented).toBe(true);
  expect(store.composer('s1').text).toBe('');
  await store.setSendKey('enter');
  // A file still uploading: Enter breaks the line, ⌘ Enter under the default would too.
  store.attach('s1', [txt]);
  await ta.setValue('wait');
  expect(bareEnter(ta.element)?.defaultPrevented).toBe(false);
  await store.setSendKey('meta');
  expect(press(ta.element, { metaKey: true }).defaultPrevented).toBe(true);
  await wrapper.vm.$nextTick();
  expect(ta.element.value).toBe('wait\n');
  expect(calls('agent.send')).toEqual([]);
  await until(() => store.composer('s1').attachments[0]?.status === 'ready');
  press(ta.element, { metaKey: true });
  await until(() => calls('agent.send').length === 1);
  wrapper.unmount();
  store.stop();
});

test('while the skill list is open a bare Enter takes the skill even as the send key; a chord is itself', async () => {
  const { store, wrapper, calls } = await withSkills([{ name: 'review', body: '' }]);
  await store.setSendKey('enter');
  const ta = wrapper.find('textarea');
  await ta.setValue('/re');
  expect(bareEnter(ta.element)).toBeNull();
  await wrapper.vm.$nextTick();
  expect(ta.element.value).toBe('/review ');
  expect(calls('agent.send')).toEqual([]);
  expect(bareEnter(ta.element)?.defaultPrevented).toBe(true);
  await until(() => calls('agent.send').length === 1);
  expect(calls('agent.send')).toEqual([{ session: 's1', text: '/review' }]);
  await until(() => store.composer('s1').text === '');
  // ⇧ Enter over the list is the browser's line break rather than a pick; as the send key it
  // sends over the list.
  await ta.setValue('/re');
  expect(bareEnter(ta.element, { shiftKey: true })?.defaultPrevented).toBe(false);
  expect(wrapper.find('.slash-suggest').exists()).toBe(true);
  await store.setSendKey('shift');
  expect(bareEnter(ta.element, { shiftKey: true })?.defaultPrevented).toBe(true);
  await until(() => calls('agent.send').length === 2);
  expect(calls('agent.send')[1]).toEqual({ session: 's1', text: '/re' });
  wrapper.unmount();
  store.stop();
});

test('no suggestions once a space is typed, or when the box has no skills', async () => {
  const { store, wrapper } = await withSkills([{ name: 'review', body: '' }]);
  await wrapper.find('textarea').setValue('/review go');
  expect(wrapper.find('.slash-suggest').exists()).toBe(false);
  wrapper.unmount();
  store.stop();
  const bare = await pairedStore([], { 'agent.send': () => ({ seq: 2 }) });
  const w2 = mount(Composer, {
    props: { store: bare.store, session: 's1', comments: [], reply: null },
    attachTo: document.body,
  });
  await until(() => bare.store.state.skills !== null);
  await flushPromises();
  await w2.find('textarea').setValue('/rev');
  expect(w2.find('.slash-suggest').exists()).toBe(false);
  w2.unmount();
  bare.store.stop();
});

test('the draft text and files survive a remount of the composer', async () => {
  const { store, wrapper } = await setup();
  await wrapper.find('textarea').setValue('draft');
  store.attach('s1', [txt]);
  wrapper.unmount();
  const again = mount(Composer, {
    props: { store, session: 's1', comments: [], reply: null },
  });
  expect(again.find('textarea').element.value).toBe('draft');
  expect(chips(again)).toEqual(['notes.txt']);
  again.unmount();
  store.stop();
});

// The box is a line tall, sized by useAutoGrow with no drag handle, on a keystroke and on another
// session's draft coming in, which changes the text under it; a ResizeObserver on the composer
// tells the screen it resized, whatever inside it grew, and goes with the component.
test('the box starts at one line and grows with the draft, on typing and on a session switch', async () => {
  fakeResizeObserver.install();
  const { store, wrapper } = await setup();
  const area = wrapper.find('textarea');
  expect(area.attributes('rows')).toBe('1');
  area.element.style.lineHeight = '20px';
  let lines = 1;
  Object.defineProperty(area.element, 'scrollHeight', {
    get: () => lines * 20,
    configurable: true,
  });
  lines = 2;
  await area.setValue('a\nb');
  expect(area.element.style.height).toBe('40px');
  store.composer('s2').text = 'a\nb\nc';
  lines = 3;
  await wrapper.setProps({ session: 's2' });
  expect(area.element.style.height).toBe('60px');
  expect(fakeResizeObserver.observed()).toEqual([wrapper.element]);
  fakeResizeObserver.fire();
  expect(wrapper.emitted('resized')).toHaveLength(1);
  wrapper.unmount();
  expect(fakeResizeObserver.disconnected()).toBe(1);
  fakeResizeObserver.uninstall();
});
