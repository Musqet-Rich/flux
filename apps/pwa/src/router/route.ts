// The PWA's screens as URL paths (ADR 0004: a hand-rolled route switch, no vue-router). The
// fragment is reserved for pairing links (protocol.md § 1), so routes live in the path and query.
// A renamed file's diff carries its old path as `from`, which is what the base revision has.

export type Route =
  | { name: 'sessions' }
  | { name: 'new' }
  | { name: 'session'; session: string }
  | { name: 'changes'; session: string }
  | { name: 'diff'; session: string; path: string; from?: string };

const diff = (session: string, search: string): Route | null => {
  const query = new URLSearchParams(search);
  const path = query.get('path');
  const from = query.get('from');
  if (path === null) return null;
  return from === null ? { name: 'diff', session, path } : { name: 'diff', session, path, from };
};

const parse = (pathname: string, search = ''): Route => {
  const parts = pathname.split('/').filter((p) => p !== '');
  if (parts.length === 0) return { name: 'sessions' };
  if (parts[0] === 'new' && parts.length === 1) return { name: 'new' };
  const session = parts[1];
  if (parts[0] !== 's' || session === undefined) return { name: 'sessions' };
  const tail = parts[2];
  const id = decodeURIComponent(session);
  if (parts.length === 2) return { name: 'session', session: id };
  if (tail === 'changes' && parts.length === 3) return { name: 'changes', session: id };
  const target = tail === 'diff' && parts.length === 3 ? diff(id, search) : null;
  return target ?? { name: 'session', session: id };
};

const path = (r: Route): string => {
  if (r.name === 'sessions') return '/';
  if (r.name === 'new') return '/new';
  const base = `/s/${encodeURIComponent(r.session)}`;
  if (r.name === 'session') return base;
  if (r.name === 'changes') return `${base}/changes`;
  const query = new URLSearchParams({ path: r.path });
  if (r.from !== undefined) query.set('from', r.from);
  return `${base}/diff?${query.toString()}`;
};

export const route: { parse: typeof parse; path: typeof path } = { parse, path };
