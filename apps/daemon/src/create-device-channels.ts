import type { Bytes, Channel, Wire } from '@flux/protocol';
import { base64url, bytes, createChannel, frame, handshake, room, wire } from '@flux/protocol';

import type { BoxIdentity, Device } from './create-device-store.ts';

// The box side of protocol.md § 3: one encrypted channel per connected device, keyed by the
// device's fingerprint. The transport hands every binary frame from the relay in here and sends
// whatever comes back out; this module never touches a socket.

export interface Peer {
  fingerprint: string;
  publicKey: Bytes;
  device: Device | null;
}

export interface DeviceChannels {
  handleFrame: (data: Bytes, send: (data: Bytes) => void) => Promise<void>;
  broadcast: (message: Wire, send: (data: Bytes) => void) => Promise<void>;
  sendTo: (fingerprint: string, message: Wire, send: (data: Bytes) => void) => Promise<boolean>;
  // Tells every channel of a device that it is revoked and forgets it. A channel busy
  // answering an rpc (the device removing itself) gets the answer first, then the notice.
  revoke: (deviceId: string, send: (data: Bytes) => void) => Promise<void>;
  peers: () => Peer[];
  reset: () => void;
}

export interface DeviceChannelsOptions {
  identity: BoxIdentity;
  roomId: string;
  deviceByKey: (publicKey: Bytes) => Device | null;
  pairingOpen: () => boolean;
  onMessage: (peer: Peer, message: Wire) => Promise<Wire | null>;
}

interface Connected {
  peer: Peer;
  channel: Channel;
  // Frames of this device being answered right now, and whether a revocation waits on them.
  busy: number;
  revoked: boolean;
}

interface State {
  options: DeviceChannelsOptions;
  connected: Map<string, Connected>;
}

type Send = (data: Bytes) => void;

const hex = (data: Bytes): string =>
  Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

const encode = (message: Wire): Bytes => bytes.fromUtf8(JSON.stringify(message));

interface DeviceHelloBytes {
  devPub: Bytes;
  devEph: Bytes;
  nonceD: Bytes;
}

const parseHello = (payload: Bytes): DeviceHelloBytes | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toUtf8(payload));
  } catch {
    return null;
  }
  if (!handshake.isDeviceHello(parsed)) return null;
  return {
    devPub: base64url.decode(parsed.devPub),
    devEph: base64url.decode(parsed.devEph),
    nonceD: base64url.decode(parsed.nonceD),
  };
};

const accept = async (state: State, payload: Bytes, send: Send): Promise<void> => {
  const { options } = state;
  const hello = parseHello(payload);
  if (hello === null) return;
  const device = options.deviceByKey(hello.devPub);
  // An unknown device is only answered while `flux pair` has a live secret.
  if (device === null && !options.pairingOpen()) return;
  const fingerprintBytes = await room.fingerprint(hello.devPub);
  const ephemeral = await handshake.generateKeyPair();
  const nonceB = handshake.nonce();
  const keys = await handshake.derive({
    role: 'box',
    staticPrivate: options.identity.privateKey,
    staticPeerPublic: hello.devPub,
    ephemeralPrivate: ephemeral.privateKey,
    ephemeralPeerPublic: hello.devEph,
    nonceD: hello.nonceD,
    nonceB,
    roomId: options.roomId,
  });
  const fingerprint = hex(fingerprintBytes);
  const channel = createChannel({ keys, fingerprint: fingerprintBytes });
  const peer = { fingerprint, publicKey: hello.devPub, device };
  state.connected.set(fingerprint, { peer, channel, busy: 0, revoked: false });
  const reply = {
    v: 1,
    boxEph: base64url.encode(ephemeral.publicKey),
    nonceB: base64url.encode(nonceB),
    to: base64url.encode(fingerprintBytes),
  };
  const payloadOut = bytes.fromUtf8(JSON.stringify(reply));
  send(frame.encode({ kind: frame.kind.handshake, payload: payloadOut }));
};

const openWire = async (entry: Connected, data: Bytes): Promise<Wire | null> => {
  try {
    const plaintext = await entry.channel.open(data);
    if (plaintext === null) return null;
    const parsed: unknown = JSON.parse(bytes.toUtf8(plaintext));
    return wire.is(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const notice = (deviceId: string): Wire => ({
  kind: 'ephemeral',
  data: { type: 'device.revoked', deviceId },
});

const disconnect = async (state: State, entry: Connected, send: Send): Promise<void> => {
  const { device } = entry.peer;
  state.connected.delete(entry.peer.fingerprint);
  entry.peer.device = null;
  if (device !== null) send(await entry.channel.seal(encode(notice(device.deviceId))));
};

const revoke = async (state: State, deviceId: string, send: Send): Promise<void> => {
  const entries = [...state.connected.values()].filter(
    (entry) => entry.peer.device?.deviceId === deviceId,
  );
  for (const entry of entries) entry.revoked = true;
  await Promise.all(
    entries.filter((entry) => entry.busy === 0).map((entry) => disconnect(state, entry, send)),
  );
};

const deliver = async (state: State, entry: Connected, data: Bytes, send: Send): Promise<void> => {
  const message = await openWire(entry, data);
  if (message === null) return;
  entry.busy += 1;
  try {
    const reply = await state.options.onMessage(entry.peer, message);
    if (reply !== null) send(await entry.channel.seal(encode(reply)));
  } finally {
    entry.busy -= 1;
  }
  if (entry.revoked && entry.busy === 0) await disconnect(state, entry, send);
};

const handleFrame = async (state: State, data: Bytes, send: Send): Promise<void> => {
  let decoded: ReturnType<typeof frame.decode>;
  try {
    decoded = frame.decode(data);
  } catch {
    return;
  }
  if (decoded.kind === frame.kind.handshake) {
    await accept(state, decoded.payload, send);
    return;
  }
  const entry = state.connected.get(hex(new Uint8Array(decoded.fingerprint)));
  if (entry !== undefined) await deliver(state, entry, data, send);
};

export const createDeviceChannels = (options: DeviceChannelsOptions): DeviceChannels => {
  const state: State = { options, connected: new Map() };
  return {
    handleFrame: (data, send) => handleFrame(state, data, send),
    sendTo: async (fingerprint, message, send) => {
      const entry = state.connected.get(fingerprint);
      if (entry === undefined) return false;
      send(await entry.channel.seal(encode(message)));
      return true;
    },
    revoke: (deviceId, send) => revoke(state, deviceId, send),
    // Sealed and sent per device, never sealed for all and then sent: a channel numbers its
    // frames as it seals them, and a reply sealed after this broadcast (an rpc.result behind
    // the event a handler appended) must not leave before it, or the device refuses the event.
    broadcast: async (message, send) => {
      const payload = encode(message);
      const entries = [...state.connected.values()];
      await Promise.all(entries.map((entry) => entry.channel.seal(payload).then(send)));
    },
    peers: () => [...state.connected.values()].map((entry) => entry.peer),
    reset: () => {
      state.connected.clear();
    },
  };
};
