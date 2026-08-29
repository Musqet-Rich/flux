import type { IncomingMessage } from 'node:http';

// The key the per-IP connection limit counts under (protocol.md § 2). Behind a reverse proxy
// every socket comes from 127.0.0.1, so the limit would be one bucket for everybody; with
// `trustProxy` the client address is taken from X-Forwarded-For instead. The proxy appends the
// address it saw to the end of that header, so the last entry is the one hop it vouches for;
// anything before it was sent by the client and is only as trustworthy as the proxy makes it
// (Caddy replaces the header unless the sender is a configured trusted proxy). Never trust the
// header without the flag: a direct client could then pick its own bucket.

export const clientKey = (request: IncomingMessage, trustProxy: boolean): string => {
  const socketAddress = request.socket.remoteAddress ?? '';
  if (!trustProxy) return socketAddress;
  const header = request.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const hops = raw
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '');
  return hops.at(-1) ?? socketAddress;
};
