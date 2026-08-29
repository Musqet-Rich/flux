import type { Bytes } from '@flux/protocol';
import { pairing } from '@flux/protocol';

import type { DeviceStore } from './create-device-store.ts';

// Pairing is open for a window after each URL is minted (protocol.md § 2); the transport
// consults `open` when an unknown device arrives.

export interface PairingGate {
  url: () => string;
  open: () => boolean;
}

export interface PairingGateOptions {
  relayUrl: string;
  boxPub: Bytes;
  devices: DeviceStore;
  windowMs?: number;
}

const defaultWindowMs = 10 * 60 * 1000;

export const createPairingGate = (options: PairingGateOptions): PairingGate => {
  const windowMs = options.windowMs ?? defaultWindowMs;
  let until = 0;
  return {
    url: () => {
      until = Date.now() + windowMs;
      const secret = options.devices.newSecret();
      return pairing.url(options.relayUrl, { boxPub: options.boxPub, secret });
    },
    open: () => Date.now() < until,
  };
};
