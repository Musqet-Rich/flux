import type { RouterHistory } from './create-router.ts';

// The real History API behind the router; tests substitute an in-memory one.

export const browserHistory: RouterHistory = {
  location: () => ({ pathname: location.pathname, search: location.search }),
  push: (path) => {
    history.pushState(null, '', path);
  },
  replace: (path) => {
    history.replaceState(null, '', path);
  },
  listen: (onChange) => {
    addEventListener('popstate', onChange);
  },
};
