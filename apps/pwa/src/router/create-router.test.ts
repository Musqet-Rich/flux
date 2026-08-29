import { expect, test } from 'vitest';

import type { RouterHistory } from './create-router.ts';
import { createRouter } from './create-router.ts';

const noop = (): void => {};

// A History with a back stack, so popstate can be exercised.
const fakeHistory = (start: string) => {
  const stack = [start];
  let index = 0;
  let onChange = noop;
  const current = (): string => stack[index] ?? '/';
  const history: RouterHistory = {
    location: () => {
      const [pathname, search] = current().split('?');
      return { pathname: pathname ?? '/', search: search === undefined ? '' : `?${search}` };
    },
    push: (path) => {
      stack.splice(index + 1);
      stack.push(path);
      index += 1;
    },
    replace: (path) => {
      stack[index] = path;
    },
    listen: (cb) => {
      onChange = cb;
    },
  };
  return {
    history,
    back: () => {
      index -= 1;
      onChange();
    },
    stack,
  };
};

test('reads the initial route, pushes and replaces, and follows back navigation', () => {
  const { history, back, stack } = fakeHistory('/s/one/changes');
  const router = createRouter(history);
  expect(router.current.route).toEqual({ name: 'changes', session: 'one' });
  router.go({ name: 'diff', session: 'one', path: 'a.ts' });
  expect(stack).toEqual(['/s/one/changes', '/s/one/diff?path=a.ts']);
  expect(router.current.route).toEqual({ name: 'diff', session: 'one', path: 'a.ts' });
  router.replace({ name: 'new' });
  expect(stack).toEqual(['/s/one/changes', '/new']);
  back();
  expect(router.current.route).toEqual({ name: 'changes', session: 'one' });
});

test('an unknown path is replaced by its fallback, and going nowhere new pushes nothing', () => {
  const { history, stack } = fakeHistory('/s/one/nope?x=1');
  const router = createRouter(history);
  expect(router.current.route).toEqual({ name: 'session', session: 'one' });
  expect(stack).toEqual(['/s/one']);
  router.go({ name: 'session', session: 'one' });
  expect(stack).toEqual(['/s/one']);
  router.go({ name: 'sessions' });
  expect(stack).toEqual(['/s/one', '/']);
});
