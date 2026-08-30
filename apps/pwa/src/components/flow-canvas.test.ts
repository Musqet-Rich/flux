import { mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';

import FlowCanvas from './FlowCanvas.vue';

// happy-dom's canvas has no 2D context, so the component's guard would bail before the loop ever
// starts. Stub getContext with a non-null object and rAF with a spy that returns a known id and
// does not re-arm, so the loop starts once and its teardown is observable without a real timer.
const stubCanvas = (): void => {
  const ctx = {} as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
};
const reduceMotion = (reduce: boolean): void => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduce } as MediaQueryList);
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('starts the loop and tears down the frame and observer on unmount', () => {
  stubCanvas();
  reduceMotion(false);
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
  const cancel = vi.spyOn(window, 'cancelAnimationFrame');
  const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect');

  const wrapper = mount(FlowCanvas);
  expect(raf).toHaveBeenCalledTimes(1);

  wrapper.unmount();
  expect(cancel).toHaveBeenCalledWith(7);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test('honours prefers-reduced-motion by never starting the loop', () => {
  stubCanvas();
  reduceMotion(true);
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);

  const wrapper = mount(FlowCanvas);
  expect(raf).not.toHaveBeenCalled();
  wrapper.unmount();
});
