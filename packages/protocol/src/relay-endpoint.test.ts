import { expect, test } from 'vitest';

import { relayEndpoint } from './relay-endpoint.ts';

const room = 'AAAAAAAAAAAAAAAAAAAAAA';

test.each([
  ['https://flux.example', 'wss://flux.example/ws/AAAAAAAAAAAAAAAAAAAAAA'],
  ['wss://flux.example:8443/', 'wss://flux.example:8443/ws/AAAAAAAAAAAAAAAAAAAAAA'],
  ['https://flux.example/?x=1#frag', 'wss://flux.example/ws/AAAAAAAAAAAAAAAAAAAAAA'],
  ['http://127.0.0.1:8787', 'ws://127.0.0.1:8787/ws/AAAAAAAAAAAAAAAAAAAAAA'],
  ['http://localhost:5173', 'ws://localhost:5173/ws/AAAAAAAAAAAAAAAAAAAAAA'],
  ['http://LOCALHOST:5173', 'ws://localhost:5173/ws/AAAAAAAAAAAAAAAAAAAAAA'],
  ['ws://[::1]:8787', 'ws://[::1]:8787/ws/AAAAAAAAAAAAAAAAAAAAAA'],
])('websocket(%s) is %s', (relayUrl, expected) => {
  expect(relayEndpoint.websocket(relayUrl, room)).toBe(expected);
});

test.each([
  'http://flux.example',
  'ws://flux.example/ws',
  'http://10.0.0.5:8787',
  'http://box.local',
  'ftp://flux.example',
])('websocket(%s) refuses a plaintext transport off loopback', (relayUrl) => {
  expect(() => relayEndpoint.websocket(relayUrl, room)).toThrow(
    expect.objectContaining({ code: 'insecure_transport' }),
  );
});

test('isLoopback names the loopback hosts only', () => {
  const yes = ['localhost', '127.0.0.1', '::1', '[::1]'].map((h) => relayEndpoint.isLoopback(h));
  expect(yes).toEqual([true, true, true, true]);
  const no = ['127.0.0.2', 'localhost.example', '0.0.0.0'].map((h) => relayEndpoint.isLoopback(h));
  expect(no).toEqual([false, false, false]);
});
