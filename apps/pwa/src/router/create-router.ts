import { reactive, readonly } from 'vue';

import type { Route } from './route.ts';
import { route } from './route.ts';

// Route state as a reactive object, driven by a History-shaped port so tests run without a
// browser: `location` reads the current path, `push`/`replace` write it, `listen` reports
// back/forward navigation.

export interface RouterHistory {
  location: () => { pathname: string; search: string };
  push: (path: string) => void;
  replace: (path: string) => void;
  listen: (onChange: () => void) => void;
}

export interface Router {
  current: Readonly<{ route: Route }>;
  go: (to: Route) => void;
  replace: (to: Route) => void;
}

export const createRouter = (history: RouterHistory): Router => {
  const read = (): Route => {
    const { pathname, search } = history.location();
    return route.parse(pathname, search);
  };
  const state = reactive<{ route: Route }>({ route: read() });
  history.listen(() => {
    state.route = read();
  });
  return {
    current: readonly(state),
    go: (to) => {
      history.push(route.path(to));
      state.route = to;
    },
    replace: (to) => {
      history.replace(route.path(to));
      state.route = to;
    },
  };
};
