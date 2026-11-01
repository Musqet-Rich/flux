import { base64url, handshake, pairing } from '@flux/protocol';

import { ClientError } from './client-error.ts';
import type { Connection, ConnectionOptions } from './create-connection.ts';
import { createConnection } from './create-connection.ts';
import type { PairedBox } from './paired-box.ts';
import { pairedBox } from './paired-box.ts';

// Pairing from a scanned or tapped URL (protocol.md § 1): generate this device's keypair, reach
// the box through the relay named by the URL and prove possession of the one-time secret.
// The connection stays up for the caller to keep using. Aborting `signal` (the operator closed
// the "Pair another daemon" dialog) stops the connection, which rejects whatever step is waiting,
// until the box has accepted the device.

export type PairDeviceOptions = Pick<
  ConnectionOptions,
  'socket' | 'onEvent' | 'onEphemeral' | 'onStatus' | 'onError' | 'minBackoffMs' | 'maxBackoffMs'
> & {
  relayUrl: string;
  fragment: string;
  signal?: AbortSignal;
};

export interface PairDeviceResult {
  box: PairedBox;
  connection: Connection;
}

export const pairDevice = async (options: PairDeviceOptions): Promise<PairDeviceResult> => {
  const payload = pairing.parse(options.fragment);
  if (payload === null) throw new ClientError('bad_pairing', 'not a pairing link');
  const { relayUrl, fragment: _fragment, signal, ...rest } = options;
  const keys = await handshake.generateKeyPair(true);
  const connection = await createConnection({ ...rest, relayUrl, keys, boxPub: payload.boxPub });
  const abort = (): void => {
    connection.stop();
  };
  if (signal?.aborted === true) throw new ClientError('aborted', 'pairing cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  try {
    connection.start();
    await connection.connected();
    const proof = await pairing.proof(payload.secret, keys.publicKey, payload.boxPub);
    const { deviceId } = await connection.call('pair.request', {
      devPub: base64url.encode(keys.publicKey),
      proof: base64url.encode(proof),
    });
    // The box has this device now: from here the pairing completes even if the dialog closed.
    signal?.removeEventListener('abort', abort);
    const box = await pairedBox.create(relayUrl, payload.boxPub, keys, deviceId);
    return { box, connection };
  } catch (error) {
    // A refused device has nothing to reconnect for; the caller only gets the error.
    connection.stop();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};
