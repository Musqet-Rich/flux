// happy-dom has no layout, so a scrolling element's geometry is pinned by hand for tests of
// tail-following: a 1000 px log in a 200 px viewport, `scrollTop` writable so a component's
// jumps show up, and a `scrollTo` that fires the `scroll` event a real scroll would.

import { flushPromises } from '@vue/test-utils';

const pin = (el: HTMLElement): HTMLElement => {
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: 800, writable: true, configurable: true });
  return el;
};

const scrollTo = async (el: HTMLElement, top: number): Promise<void> => {
  el.scrollTop = top;
  el.dispatchEvent(new Event('scroll'));
  await flushPromises();
};

export const fakeScroller: { pin: typeof pin; scrollTo: typeof scrollTo } = { pin, scrollTo };
