import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

import { useEscape } from './useEscape.ts';

const key = (name: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: name, cancelable: true, ...init });

const sheet = (closed: string[], name: string) =>
  mount(
    defineComponent({
      setup: () => {
        useEscape(() => {
          closed.push(name);
        });
        return () => h('form');
      },
    }),
  );

test('Escape closes the closer registered last, consumed; other, taken or IME keys and the unmounted do not', () => {
  const closed: string[] = [];
  const first = sheet(closed, 'first');
  const other = key('a');
  document.dispatchEvent(other);
  expect(closed).toEqual([]);
  expect(other.defaultPrevented).toBe(false);
  const second = sheet(closed, 'second');
  const taken = key('Escape');
  taken.preventDefault();
  document.dispatchEvent(taken);
  document.dispatchEvent(key('Escape', { isComposing: true }));
  expect(closed).toEqual([]);
  const escape = key('Escape');
  document.dispatchEvent(escape);
  expect(closed).toEqual(['second']);
  expect(escape.defaultPrevented).toBe(true);
  second.unmount();
  document.dispatchEvent(key('Escape'));
  expect(closed).toEqual(['second', 'first']);
  first.unmount();
  const idle = key('Escape');
  document.dispatchEvent(idle);
  expect(closed).toEqual(['second', 'first']);
  expect(idle.defaultPrevented).toBe(false);
});

test('given an open ref, the closer is live only while it is true', async () => {
  const open = ref(false);
  const closed: number[] = [];
  const wrapper = mount(
    defineComponent({
      setup: () => {
        useEscape(() => {
          closed.push(1);
        }, open);
        return () => h('div');
      },
    }),
  );
  document.dispatchEvent(key('Escape'));
  expect(closed).toEqual([]);
  open.value = true;
  await nextTick();
  document.dispatchEvent(key('Escape'));
  expect(closed).toEqual([1]);
  open.value = false;
  await nextTick();
  document.dispatchEvent(key('Escape'));
  expect(closed).toEqual([1]);
  open.value = true;
  await nextTick();
  wrapper.unmount();
  document.dispatchEvent(key('Escape'));
  expect(closed).toEqual([1]);
});
