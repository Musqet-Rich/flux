// A path on the box shown the way a shell prompt would: the home directory folded to `~`, so
// `/Users/rich/code/flux` reads `~/code/flux`. Only the directory itself or something under it
// folds; `/Users/richard` under home `/Users/rich` does not. Without a home (a daemon built
// before `hello` sent one) the path stays whole.
export const homePath = (path: string, home: string | null): string => {
  if (home === null || home === '' || home === '/') return path;
  const root = home.endsWith('/') ? home.slice(0, -1) : home;
  if (path === root) return '~';
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
};
