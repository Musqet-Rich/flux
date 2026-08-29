import { base64url, handshake, pairing } from '@flux/protocol';

import { ClientError } from './client-error.ts';
import type { Connection, ConnectionOptions } from './create-connection.ts';
import { createConnection } from './create-connection.ts';
import type { PairedBox } from './paired-box.ts';
import { pairedBox } from './paired-box.ts';

// Pairing from a scanned or tapped URL (protocol.md § 1): generate this device's keypair, reach
// the box through the relay named by the URL and prove possession of the one-time secret.
// The connection stays up for the caller to keep using.

export type PairDeviceOptions = Pick<
  ConnectionOptions,
  'socket' | 'onEvent' | 'onEphemeral' | 'onStatus'
> & {
  relayUrl: string;
  fragment: string;
};

export interface PairDeviceResult {
  box: PairedBox;
  connection: Connection;
}

export const pairDevice = async (options: PairDeviceOptions): Promise<PairDeviceResult> => {
  const payload = pairing.parse(options.fragment);
  if (payload === null) throw new ClientError('bad_pairing', 'not a pairing link');
  const { relayUrl, fragment: _fragment, ...rest } = options;
  const keys = await handshake.generateKeyPair(true);
  const connection = await createConnection({ ...rest, relayUrl, keys, boxPub: payload.boxPub });
  connection.start();
  await connection.connected();
  const proof = await pairing.proof(payload.secret, keys.publicKey, payload.boxPub);
  const { deviceId } = await connection.call('pair.request', {
    devPub: base64url.encode(keys.publicKey),
    proof: base64url.encode(proof),
  });
  const box = await pairedBox.create(relayUrl, payload.boxPub, keys, deviceId);
  return { box, connection };
};
