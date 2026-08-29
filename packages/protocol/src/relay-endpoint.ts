import { ProtocolError } from './protocol-error.ts';

// Where a party connects to the relay (protocol.md § 2): the room's WebSocket URL from the
// relay origin the operator configured. Frames are end-to-end encrypted, but a plaintext
// WebSocket still shows the path the room id and the handshake hellos and lets it drop or
// replay handshakes at will, so `ws:` is only allowed to the machine itself. The daemon
// (`FLUX_RELAY_URL`) and the device (the pairing link's origin) apply the same rule.

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLoopback = (hostname: string): boolean => loopbackHosts.has(hostname.toLowerCase());

const socketSchemeOf: Record<string, string> = { 'http:': 'ws:', 'https:': 'wss:' };

// The room's WebSocket URL, or `insecure_transport` when it would be plaintext off loopback.
const websocket = (relayUrl: string, roomId: string): string => {
  const url = new URL(relayUrl);
  url.protocol = socketSchemeOf[url.protocol] ?? url.protocol;
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && isLoopback(url.hostname))) {
    throw new ProtocolError(
      'insecure_transport',
      `relay ${url.host} needs https:// (http:// is only allowed to localhost)`,
    );
  }
  url.pathname = `/ws/${roomId}`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

export const relayEndpoint: {
  websocket: typeof websocket;
  isLoopback: typeof isLoopback;
} = { websocket, isLoopback };
