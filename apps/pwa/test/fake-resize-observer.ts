// happy-dom's ResizeObserver never calls back, so a test of what a component does when an
// element changes size stubs it with one that keeps the observers and the elements observed, and
// fires them on request. `install` replaces the global until `uninstall` puts the real one back;
// a test calls both, since vitest does not unstub globals on its own here.

import { vi } from 'vitest';

const observers: FakeResizeObserver[] = [];
const observed: Element[] = [];
let disconnected = 0;

class FakeResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(target: Element): void {
    observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    disconnected += 1;
  }
  fire(): void {
    this.callback([], this);
  }
}

const install = (): void => {
  observers.length = 0;
  observed.length = 0;
  disconnected = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
};

// Every observer sees a size change.
const fire = (): void => {
  for (const observer of observers) observer.fire();
};

export const fakeResizeObserver = {
  install,
  uninstall: (): void => {
    vi.unstubAllGlobals();
  },
  fire,
  observed: (): Element[] => [...observed],
  disconnected: (): number => disconnected,
};
