// The PWA's screens as URL paths (ADR 0004: a hand-rolled route switch, no vue-router). The
// fragment is reserved for pairing links (protocol.md § 1), so routes live in the path and query.

export type Route =
  | { name: 'sessions' }
  | { name: 'new' }
  | { name: 'session'; session: string }
  | { name: 'changes'; session: string }
  | { name: 'diff'; session: string; path: string };

const parse = (pathname: string, search = ''): Route => {
  const parts = pathname.split('/').filter((p) => p !== '');
  if (parts.length === 0) return { name: 'sessions' };
  if (parts[0] === 'new' && parts.length === 1) return { name: 'new' };
  const session = parts[1];
  if (parts[0] !== 's' || session === undefined) return { name: 'sessions' };
  const tail = parts[2];
  if (parts.length === 2) return { name: 'session', session: decodeURIComponent(session) };
  const id = decodeURIComponent(session);
  if (tail === 'changes' && parts.length === 3) return { name: 'changes', session: id };
  const path = new URLSearchParams(search).get('path');
  if (tail === 'diff' && parts.length === 3 && path !== null) {
    return { name: 'diff', session: id, path };
  }
  return { name: 'session', session: id };
};

const path = (r: Route): string => {
  if (r.name === 'sessions') return '/';
  if (r.name === 'new') return '/new';
  const base = `/s/${encodeURIComponent(r.session)}`;
  if (r.name === 'session') return base;
  if (r.name === 'changes') return `${base}/changes`;
  return `${base}/diff?path=${encodeURIComponent(r.path)}`;
};

export const route: { parse: typeof parse; path: typeof path } = { parse, path };
