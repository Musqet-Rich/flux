import { reactive, readonly } from 'vue';

import type { Route } from './route.ts';
import { route } from './route.ts';

// Route state as a reactive object, driven by a History-shaped port so tests run without a
// browser: `location` reads the current path, `push`/`replace` write it, `listen` reports
// back/forward navigation. A path the app does not know is replaced by the screen it fell
// back to, so the address bar never shows a route that would not survive a reload.

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
    const parsed = route.parse(pathname, search);
    if (route.path(parsed) !== `${pathname}${search}`) history.replace(route.path(parsed));
    return parsed;
  };
  const state = reactive<{ route: Route }>({ route: read() });
  history.listen(() => {
    state.route = read();
  });
  return {
    current: readonly(state),
    go: (to) => {
      // Tapping the tab already shown must not grow the history.
      if (route.path(to) === route.path(state.route)) return;
      history.push(route.path(to));
      state.route = to;
    },
    replace: (to) => {
      history.replace(route.path(to));
      state.route = to;
    },
  };
};
