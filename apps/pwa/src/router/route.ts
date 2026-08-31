// The PWA's screens as URL paths (ADR 0004: a hand-rolled route switch, no vue-router). The
// fragment is reserved for pairing links (protocol.md § 1), so routes live in the path and query.
// A renamed file's diff carries its old path as `from`, which is what the base revision has.
// The editor takes the same `path` query and saves to the worktree.

export type Route =
  | { name: 'sessions' }
  | { name: 'new' }
  | { name: 'settings' }
  | { name: 'runner' }
  | { name: 'session'; session: string }
  | { name: 'changes'; session: string }
  | { name: 'files'; session: string; path: string }
  | { name: 'diff'; session: string; path: string; from?: string }
  | { name: 'edit'; session: string; path: string; dir?: string };

// The editor and diff both live under `path`. The editor also carries `dir` when it was opened
// from the file browser, so its back returns to the browser at that directory, not to changes.
const file = (tail: string, session: string, search: string): Route | null => {
  const query = new URLSearchParams(search);
  const path = query.get('path');
  const from = query.get('from');
  const dir = query.get('dir');
  if (path === null) return null;
  if (tail === 'edit')
    return dir === null ? { name: 'edit', session, path } : { name: 'edit', session, path, dir };
  return from === null ? { name: 'diff', session, path } : { name: 'diff', session, path, from };
};

const parse = (pathname: string, search = ''): Route => {
  const parts = pathname.split('/').filter((p) => p !== '');
  if (parts.length === 0) return { name: 'sessions' };
  if (parts[0] === 'new' && parts.length === 1) return { name: 'new' };
  if (parts[0] === 'settings' && parts.length === 1) return { name: 'settings' };
  if (parts[0] === 'runner' && parts.length === 1) return { name: 'runner' };
  const session = parts[1];
  if (parts[0] !== 's' || session === undefined) return { name: 'sessions' };
  const tail = parts[2];
  const id = decodeURIComponent(session);
  if (parts.length === 2) return { name: 'session', session: id };
  if (tail === 'changes' && parts.length === 3) return { name: 'changes', session: id };
  if (tail === 'files' && parts.length === 3)
    return { name: 'files', session: id, path: new URLSearchParams(search).get('path') ?? '' };
  const isFile = (tail === 'diff' || tail === 'edit') && parts.length === 3;
  const target = isFile ? file(tail, id, search) : null;
  return target ?? { name: 'session', session: id };
};

const path = (r: Route): string => {
  if (r.name === 'sessions') return '/';
  if (r.name === 'new') return '/new';
  if (r.name === 'settings') return '/settings';
  if (r.name === 'runner') return '/runner';
  const base = `/s/${encodeURIComponent(r.session)}`;
  if (r.name === 'session') return base;
  if (r.name === 'changes') return `${base}/changes`;
  if (r.name === 'files')
    return r.path === ''
      ? `${base}/files`
      : `${base}/files?${new URLSearchParams({ path: r.path }).toString()}`;
  const query = new URLSearchParams({ path: r.path });
  if (r.name === 'edit') {
    if (r.dir !== undefined) query.set('dir', r.dir);
    return `${base}/edit?${query.toString()}`;
  }
  if (r.from !== undefined) query.set('from', r.from);
  return `${base}/diff?${query.toString()}`;
};

export const route: { parse: typeof parse; path: typeof path } = { parse, path };
