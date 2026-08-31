import type { Bytes, Channel, HandshakeTranscript, Wire } from '@flux/protocol';
import {
  base64url,
  bytes,
  createChannel,
  frame,
  handshake,
  protocolVersion,
  room,
  wire,
} from '@flux/protocol';

import type { BoxIdentity, Device } from './create-device-store.ts';

// The box side of protocol.md § 3: one encrypted channel per completed handshake, grouped by
// the device's fingerprint. Every tab of one browser profile shares the device's static key, so
// one device may hold several channels at once, each with its own session keys. The transport
// hands every binary frame from the relay in here and sends whatever comes back out; this
// module never touches a socket.

export interface Peer {
  fingerprint: string;
  publicKey: Bytes;
  device: Device | null;
}

export interface DeviceChannels {
  handleFrame: (data: Bytes, send: (data: Bytes) => void) => Promise<void>;
  broadcast: (message: Wire, send: (data: Bytes) => void) => Promise<void>;
  // Every channel of the device gets its own sealed copy; false when it has none.
  sendTo: (fingerprint: string, message: Wire, send: (data: Bytes) => void) => Promise<boolean>;
  // Revokes a device on every channel it holds: its trust is gone at once (frames already
  // in flight are dropped, a handler sees `device: null`), it is told, and it is forgotten. A
  // channel busy answering an rpc (the device removing itself) gets that answer first.
  revoke: (deviceId: string, send: (data: Bytes) => void) => Promise<void>;
  // One entry per device, however many channels it holds.
  peers: () => Peer[];
  reset: () => void;
}

export interface DeviceChannelsOptions {
  identity: BoxIdentity;
  deviceByKey: (publicKey: Bytes) => Device | null;
  pairingOpen: () => boolean;
  onMessage: (peer: Peer, message: Wire) => Promise<Wire | null>;
  now?: () => Date;
  // A paired device just lost its last channel (its socket dropped, or its handshake went stale):
  // the command runner (ADR 0026) kills any run it had, so no process is left with nobody to see
  // it. Fired once per device, never on a revoke (that path tells the runner directly).
  onDeviceGone?: (deviceId: string) => void;
}

// The relay admits this many guests per room (protocol.md § 2), so a device cannot hold more
// live connections than this. The relay tells the host nothing when a guest leaves, so a channel
// whose tab is gone is only found out when the device's channels pass the cap. Past it, the
// channels still waiting for their first frame go first, oldest first: anyone in the room can
// replay handshakes under a device's public key, and that must never cost the device a channel
// that works. A confirmed channel only goes for a confirmed newcomer, when the device really
// holds more working tabs than the relay lets in, and then the one heard from least recently.
const maxChannelsPerDevice = 8;

// A handshake whose first frame has not arrived within this long was never going to be
// confirmed (the device's own `hello` times out well before it), so it is dropped the next time
// the box admits or hears a frame for the device. No timer: the check is lazy.
const confirmWithinMs = 30_000;

// Tabs restored together all handshake before any of them sends its first frame, so a pending
// channel this young is not evicted for another handshake, up to `maxChannelsPerDevice` pending
// ones; beyond that the oldest goes regardless. A device therefore holds at most twice the cap.
const confirmGraceMs = 2_000;

interface Connected {
  peer: Peer;
  channel: Channel;
  // Whether a frame has opened on this channel yet. The device's first data frame is its key
  // confirmation (protocol.md § 3): until it opens, the handshake is not known to have worked.
  confirmed: boolean;
  // Frames of this channel being answered right now; the notice waits for them.
  busy: number;
  // The device id this channel was revoked as, once it is.
  revoked: string | null;
  // The tick of the last frame this channel opened, or of its handshake.
  heard: number;
  // Wall-clock time of the handshake, for `confirmWithinMs`.
  since: number;
}

interface State {
  options: DeviceChannelsOptions;
  // Channels by device fingerprint, in handshake order.
  connected: Map<string, Connected[]>;
  tick: number;
  now: () => Date;
}

type Send = (data: Bytes) => void;

const hex = (data: Bytes): string =>
  Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

const encode = (message: Wire): Bytes => bytes.fromUtf8(JSON.stringify(message));

interface DeviceHelloBytes {
  v: number;
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
    v: parsed.v,
    devPub: base64url.decode(parsed.devPub),
    devEph: base64url.decode(parsed.devEph),
    nonceD: base64url.decode(parsed.nonceD),
  };
};

const channelsOf = (state: State, fingerprint: string): Connected[] =>
  state.connected.get(fingerprint) ?? [];

const forget = (state: State, entry: Connected): void => {
  const remaining = channelsOf(state, entry.peer.fingerprint).filter((c) => c !== entry);
  if (remaining.length === 0) {
    state.connected.delete(entry.peer.fingerprint);
    // The device is gone from the box (revoke nulls `device` first, so it does not fire here).
    if (entry.peer.device !== null) state.options.onDeviceGone?.(entry.peer.device.deviceId);
  } else state.connected.set(entry.peer.fingerprint, remaining);
};

const quietest = (entries: Connected[]): Connected | null =>
  entries.reduce<Connected | null>((a, b) => (a === null || b.heard < a.heard ? b : a), null);

// The device's channels still in their handshake window; a stale one is forgotten on the way.
const withoutStale = (state: State, fingerprint: string): Connected[] => {
  const deadline = state.now().getTime() - confirmWithinMs;
  const all = channelsOf(state, fingerprint);
  const live = all.filter((c) => c.confirmed || c.since > deadline);
  if (live.length === 0) {
    state.connected.delete(fingerprint);
    const device = all.find((c) => c.peer.device !== null)?.peer.device ?? null;
    if (all.length > 0 && device !== null) state.options.onDeviceGone?.(device.deviceId);
  } else state.connected.set(fingerprint, live);
  return live;
};

// Among the channels still waiting for their first frame (handshake order, so the first is
// the oldest), the one a new handshake past the cap may evict: null while the oldest is inside
// its grace and the device holds no more pending channels than the cap.
const evictable = (state: State, pending: Connected[]): Connected | null => {
  const oldest = pending[0];
  if (oldest === undefined) return null;
  const settling = oldest.since > state.now().getTime() - confirmGraceMs;
  return settling && pending.length <= maxChannelsPerDevice ? null : oldest;
};

// A new handshake past the cap evicts the oldest channel still waiting for its first frame,
// never a confirmed one: the newcomer is itself unconfirmed, and only earns a confirmed
// channel's place by confirming (`confirm`). The newcomer is never the victim: it is the
// youngest, so if it is the oldest pending it is alone and inside its grace.
const admit = (state: State, entry: Connected): void => {
  const entries = [...withoutStale(state, entry.peer.fingerprint), entry];
  if (entries.length > maxChannelsPerDevice) {
    const victim = evictable(
      state,
      entries.filter((c) => !c.confirmed),
    );
    if (victim !== null) entries.splice(entries.indexOf(victim), 1);
  }
  state.connected.set(entry.peer.fingerprint, entries);
};

// A channel's first opened frame confirms it. If that puts the device over the cap in
// confirmed channels, it has more working tabs than the relay admits, so the confirmed channel
// heard from least recently (a tab that has gone quiet) makes room.
const confirm = (state: State, entry: Connected): void => {
  entry.confirmed = true;
  const confirmed = channelsOf(state, entry.peer.fingerprint).filter((c) => c.confirmed);
  if (confirmed.length <= maxChannelsPerDevice) return;
  const victim = quietest(confirmed.filter((c) => c !== entry));
  if (victim !== null) forget(state, victim);
};

interface Agreement {
  hello: DeviceHelloBytes;
  device: Device | null;
  fingerprintBytes: Bytes;
  ephemeralPrivate: CryptoKey;
  nonceB: Bytes;
  transcript: HandshakeTranscript;
}

const admitChannel = async (state: State, a: Agreement): Promise<void> => {
  const keys = await handshake.derive({
    role: 'box',
    staticPrivate: state.options.identity.privateKey,
    staticPeerPublic: a.hello.devPub,
    ephemeralPrivate: a.ephemeralPrivate,
    ephemeralPeerPublic: a.hello.devEph,
    nonceD: a.hello.nonceD,
    nonceB: a.nonceB,
    transcript: a.transcript,
  });
  const channel = createChannel({ keys, fingerprint: a.fingerprintBytes });
  const peer = {
    fingerprint: hex(a.fingerprintBytes),
    publicKey: a.hello.devPub,
    device: a.device,
  };
  state.tick += 1;
  admit(state, {
    peer,
    channel,
    confirmed: false,
    busy: 0,
    revoked: null,
    heard: state.tick,
    since: state.now().getTime(),
  });
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
  const reply = {
    v: protocolVersion,
    boxEph: base64url.encode(ephemeral.publicKey),
    nonceB: base64url.encode(nonceB),
    to: base64url.encode(fingerprintBytes),
  };
  const payloadOut = bytes.fromUtf8(JSON.stringify(reply));
  // The keys are derived from both hellos exactly as sent (protocol.md § 3). A device on
  // another protocol version is answered, so it can tell its operator which side to update,
  // but gets no channel: its derivation differs from ours by construction.
  if (hello.v === protocolVersion) {
    await admitChannel(state, {
      hello,
      device,
      fingerprintBytes,
      ephemeralPrivate: ephemeral.privateKey,
      nonceB,
      transcript: { helloD: payload, helloB: payloadOut },
    });
  }
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

interface Opened {
  entry: Connected;
  message: Wire;
}

// The wire fingerprint names the device, not the connection; each handshake derived its own
// keys, so a frame opens on exactly one of the device's channels and fails on the rest. Trying
// them all at once is cheap (at most `maxChannelsPerDevice`) and a failed open leaves a channel
// as it was.
const openOnDevice = async (entries: Connected[], data: Bytes): Promise<Opened | null> => {
  const tried = await Promise.all(
    entries.map(async (entry): Promise<Opened | null> => {
      const message = await openWire(entry, data);
      return message === null ? null : { entry, message };
    }),
  );
  return tried.find((opened) => opened !== null) ?? null;
};

const notice = (deviceId: string): Wire => ({
  kind: 'ephemeral',
  data: { type: 'device.revoked', deviceId },
});

const disconnect = async (state: State, entry: Connected, send: Send): Promise<void> => {
  forget(state, entry);
  if (entry.revoked !== null) send(await entry.channel.seal(encode(notice(entry.revoked))));
};

const revoke = async (state: State, deviceId: string, send: Send): Promise<void> => {
  const entries = [...state.connected.values()]
    .flat()
    .filter((entry) => entry.peer.device?.deviceId === deviceId);
  for (const entry of entries) {
    entry.revoked = deviceId;
    // From here every handler, including one mid-call, sees a stranger.
    entry.peer.device = null;
  }
  await Promise.all(
    entries.filter((entry) => entry.busy === 0).map((entry) => disconnect(state, entry, send)),
  );
};

// A channel's first data frame carries nonce 0. One that opens on none of the device's channels
// was the key confirmation of a channel whose handshake did not agree (a tampered hello, a peer
// on other keys), so every channel still waiting for its first frame goes: the device gets
// nothing back and starts over, rather than the box keeping a channel that never decrypts.
const dropUnconfirmed = (state: State, entries: Connected[]): void => {
  for (const entry of entries) if (!entry.confirmed) forget(state, entry);
};

const deliver = async (
  state: State,
  entries: Connected[],
  decoded: { nonce: Bytes },
  data: Bytes,
  send: Send,
): Promise<void> => {
  const opened = await openOnDevice(entries, data);
  if (opened === null) {
    if (frame.counterOf(decoded.nonce) === 0) dropUnconfirmed(state, entries);
    return;
  }
  const { entry, message } = opened;
  state.tick += 1;
  entry.heard = state.tick;
  if (!entry.confirmed) confirm(state, entry);
  // A frame that was in flight when the device was revoked is dropped, not answered.
  if (entry.revoked !== null) return;
  entry.busy += 1;
  try {
    const reply = await state.options.onMessage(entry.peer, message);
    if (reply !== null) send(await entry.channel.seal(encode(reply)));
  } finally {
    entry.busy -= 1;
  }
  if (entry.revoked !== null && entry.busy === 0) await disconnect(state, entry, send);
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
  const entries = withoutStale(state, hex(new Uint8Array(decoded.fingerprint)));
  if (entries.length > 0) await deliver(state, entries, decoded, data, send);
};

// Sealed and sent per channel, never sealed for all and then sent: a channel numbers its
// frames as it seals them, and a reply sealed after this broadcast (an rpc.result behind
// the event a handler appended) must not leave before it, or the device refuses the event.
const sealToAll = async (entries: Connected[], message: Wire, send: Send): Promise<void> => {
  const payload = encode(message);
  await Promise.all(entries.map((entry) => entry.channel.seal(payload).then(send)));
};

export const createDeviceChannels = (options: DeviceChannelsOptions): DeviceChannels => {
  const state: State = {
    options,
    connected: new Map(),
    tick: 0,
    now: options.now ?? ((): Date => new Date()),
  };
  return {
    handleFrame: (data, send) => handleFrame(state, data, send),
    sendTo: async (fingerprint, message, send) => {
      const entries = channelsOf(state, fingerprint);
      if (entries.length === 0) return false;
      await sealToAll(entries, message, send);
      return true;
    },
    revoke: (deviceId, send) => revoke(state, deviceId, send),
    broadcast: (message, send) => sealToAll([...state.connected.values()].flat(), message, send),
    peers: () =>
      [...state.connected.values()].flatMap((entries) =>
        entries.slice(0, 1).map((entry) => entry.peer),
      ),
    reset: () => {
      // The relay socket dropped: every device is gone from the box at once (ADR 0026).
      for (const entries of state.connected.values()) {
        const device = entries.find((e) => e.peer.device !== null)?.peer.device ?? null;
        if (device !== null) state.options.onDeviceGone?.(device.deviceId);
      }
      state.connected.clear();
    },
  };
};
