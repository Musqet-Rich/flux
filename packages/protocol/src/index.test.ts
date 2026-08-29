import { expect, test } from 'vitest';

import * as protocol from './index.ts';

// The public surface is the contract; a module that stops being exported is a breaking change.
test('exports every runtime module', () => {
  expect(Object.keys(protocol).toSorted()).toEqual([
    'ProtocolError',
    'base64url',
    'bytes',
    'compress',
    'createChannel',
    'ephemeral',
    'eventPayloads',
    'fluxEvent',
    'frame',
    'guards',
    'handshake',
    'isCodeRef',
    'pairing',
    'protocolVersion',
    'relayEndpoint',
    'relayMessage',
    'room',
    'rpcMethods',
    'rpcResults',
    'settings',
    'wire',
  ]);
});
