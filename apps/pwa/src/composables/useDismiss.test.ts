import { expect, test } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import { useDismiss } from './useDismiss.ts';

const setup = (): { open: ReturnType<typeof ref<boolean>>; inside: HTMLElement } => {
  const root = document.createElement('div');
  const inside = document.createElement('button');
  root.append(inside);
  document.body.append(root);
  const open = ref(false);
  const scope = effectScope();
  scope.run(() => {
    useDismiss(open, ref(root));
  });
  return { open, inside };
};

const escape = 'Escape';
const tap = (target: EventTarget): void => {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};

test('Escape or a tap outside closes; a tap inside does not; closed means no listeners', async () => {
  const { open, inside } = setup();
  tap(document.body);
  expect(open.value).toBe(false);
  open.value = true;
  await nextTick();
  tap(inside);
  expect(open.value).toBe(true);
  tap(document.body);
  expect(open.value).toBe(false);
  open.value = true;
  await nextTick();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  expect(open.value).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: escape }));
  expect(open.value).toBe(false);
});
