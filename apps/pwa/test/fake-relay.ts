import type {
  Bytes,
  Channel,
  Ephemeral,
  FluxEvent,
  KeyPair,
  RpcMethods,
  Wire,
} from '@flux/protocol';
import {
  base64url,
  bytes,
  createChannel,
  frame,
  handshake,
  protocolVersion,
  relayMessage,
  room,
  wire,
} from '@flux/protocol';

import { ClientError } from '../src/client/client-error.ts';
import type { Socket, SocketFactory, SocketHandlers } from '../src/client/socket.ts';

// An in-memory relay with a box behind it, for connection tests: the client's socket factory
// yields sockets wired straight into this. The box answers RPCs from `handlers`, and the test
// can make it emit, leave and rejoin. Delivery is asynchronous, as on a real socket. A handler
// that throws a ClientError answers with that code as an rpc error, the way the box refuses.

export type Handlers = {
  [M in keyof RpcMethods]?: (params: RpcMethods[M]['params']) => RpcMethods[M]['result'];
};

export interface FakeRelay {
  socket: SocketFactory;
  boxPub: Bytes;
  calls: { method: string; params: unknown }[];
  emit: (event: FluxEvent) => Promise<void>;
  ephemeral: (data: Ephemeral) => Promise<void>;
  hostLeave: () => void;
  hostJoin: () => void;
  dropGuests: () => void;
  refuseJoins: (error: 'room_full' | null) => void;
  // Makes the box answer one method with this error code from now on.
  refuseCall: (method: string, code: string) => void;
  // Makes the box claim this protocol version in its hello: it then derives no channel.
  boxVersion: (v: number) => void;
  // Makes the box drop every data frame unanswered, as it does for a channel whose keys differ
  // from the device's (protocol.md § 3, key confirmation); the handshake still completes.
  mute: (on: boolean) => void;
  guests: () => number;
}

interface Guest {
  handlers: SocketHandlers;
  channel: Channel | null;
  open: boolean;
  joined: boolean;
}

interface State {
  boxKeys: KeyPair;
  roomId: string;
  guests: Set<Guest>;
  calls: FakeRelay['calls'];
  handlers: Record<string, ((params: unknown) => unknown) | undefined>;
  hostPresent: boolean;
  refusal: 'room_full' | null;
  refusedCalls: Map<string, string>;
  version: number;
  muted: boolean;
}

const later = (fn: () => void): void => {
  queueMicrotask(fn);
};

const deliver = (guest: Guest, data: string | Bytes): void => {
  later(() => {
    guest.handlers.message(data);
  });
};

// Sealed for one guest, delivered to all: the relay broadcasts whatever the box sends, so
// every guest sees the frames meant for the others (and for other tabs of its own device).
const reply = async (state: State, guest: Guest, message: Wire): Promise<void> => {
  if (guest.channel === null) return;
  const sealed = await guest.channel.seal(bytes.fromUtf8(JSON.stringify(message)));
  for (const other of state.guests) deliver(other, sealed);
};

const refuse = (id: string, code: string, message: string): Wire => ({
  kind: 'rpc.result',
  id,
  ok: false,
  error: { code, message },
});

const outcome = (id: string, handler: (params: unknown) => unknown, params: unknown): Wire => {
  try {
    return { kind: 'rpc.result', id, ok: true, result: handler(params) };
  } catch (error) {
    if (error instanceof ClientError) return refuse(id, error.code, error.message);
    throw error;
  }
};

const resultOf = (state: State, id: string, method: string, params: unknown): Wire => {
  const refused = state.refusedCalls.get(method);
  if (refused !== undefined) return refuse(id, refused, `${method} refused`);
  const handler = state.handlers[method];
  if (handler === undefined) return refuse(id, 'not_found', `no ${method}`);
  return outcome(id, handler, params);
};

const answer = (state: State, guest: Guest, id: string, method: string, params: unknown): void => {
  state.calls.push({ method, params });
  void reply(state, guest, resultOf(state, id, method, params));
};

const boxHandshake = async (state: State, guest: Guest, payload: Bytes): Promise<void> => {
  const hello: unknown = JSON.parse(bytes.toUtf8(payload));
  if (!handshake.isDeviceHello(hello)) return;
  const eph = await handshake.generateKeyPair();
  const nonceB = handshake.nonce();
  const devPub = base64url.decode(hello.devPub);
  const fingerprint = await room.fingerprint(devPub);
  const boxHello = {
    v: state.version,
    boxEph: base64url.encode(eph.publicKey),
    nonceB: base64url.encode(nonceB),
    to: base64url.encode(fingerprint),
  };
  const helloB = bytes.fromUtf8(JSON.stringify(boxHello));
  if (state.version === protocolVersion) {
    const keys = await handshake.derive({
      role: 'box',
      staticPrivate: state.boxKeys.privateKey,
      staticPeerPublic: devPub,
      ephemeralPrivate: eph.privateKey,
      ephemeralPeerPublic: base64url.decode(hello.devEph),
      nonceD: base64url.decode(hello.nonceD),
      nonceB,
      transcript: { helloD: payload, helloB },
    });
    guest.channel = createChannel({ keys, fingerprint });
  }
  const out = frame.encode({ kind: frame.kind.handshake, payload: helloB });
  // The box broadcasts; every guest sees every box hello and ignores the ones not for it.
  for (const other of state.guests) deliver(other, out);
};

const boxReceive = async (state: State, guest: Guest, data: Bytes): Promise<void> => {
  const decoded = frame.decode(data);
  if (decoded.kind === frame.kind.handshake) return boxHandshake(state, guest, decoded.payload);
  if (guest.channel === null || state.muted) return;
  const plaintext = await guest.channel.open(data);
  if (plaintext === null) return;
  const message: unknown = JSON.parse(bytes.toUtf8(plaintext));
  if (wire.is(message) && message.kind === 'rpc') {
    answer(state, guest, message.id, message.method, message.params);
  }
};

const onJoin = (state: State, guest: Guest, text: string): void => {
  const join: unknown = JSON.parse(text);
  if (guest.joined || !relayMessage.isJoin(join) || state.refusal !== null) {
    deliver(guest, JSON.stringify({ ok: false, error: state.refusal ?? 'bad_version' }));
    return;
  }
  guest.joined = true;
  state.guests.add(guest);
  deliver(guest, JSON.stringify({ ok: true }));
};

const disconnect = (state: State, guest: Guest): void => {
  if (!guest.open) return;
  guest.open = false;
  state.guests.delete(guest);
  later(() => {
    guest.handlers.close();
  });
};

const guestSocket = (state: State): Socket => {
  const guest: Guest = {
    handlers: { open: () => {}, message: () => {}, close: () => {} },
    channel: null,
    open: true,
    joined: false,
  };
  return {
    send: (data) => {
      if (!guest.open) return;
      if (typeof data === 'string') onJoin(state, guest, data);
      else if (state.hostPresent) void boxReceive(state, guest, data);
      else deliver(guest, JSON.stringify({ type: 'no_host' }));
    },
    close: () => {
      disconnect(state, guest);
    },
    on: (handlers) => {
      guest.handlers = handlers;
      later(handlers.open);
    },
  };
};

// Everything the box's side of the fake can be told to do from a test.
const boxControls = (state: State): Omit<FakeRelay, 'socket' | 'boxPub' | 'calls' | 'guests'> => {
  const broadcast = async (message: Wire): Promise<void> => {
    await Promise.all([...state.guests].map((guest) => reply(state, guest, message)));
  };
  const control = (type: string): void => {
    for (const guest of state.guests) deliver(guest, JSON.stringify({ type }));
  };
  return {
    emit: (event) => broadcast({ kind: 'event', event }),
    ephemeral: (data) => broadcast({ kind: 'ephemeral', data }),
    hostLeave: () => {
      state.hostPresent = false;
      for (const guest of state.guests) guest.channel = null;
      control('host_left');
    },
    hostJoin: () => {
      state.hostPresent = true;
      control('host_joined');
    },
    dropGuests: () => {
      for (const guest of state.guests) disconnect(state, guest);
    },
    refuseJoins: (error) => {
      state.refusal = error;
    },
    refuseCall: (method, code) => {
      state.refusedCalls.set(method, code);
    },
    boxVersion: (v) => {
      state.version = v;
    },
    mute: (on) => {
      state.muted = on;
    },
  };
};

export const createFakeRelay = async (handlers: Handlers): Promise<FakeRelay> => {
  const boxKeys = await handshake.generateKeyPair();
  const state: State = {
    boxKeys,
    roomId: await room.id(boxKeys.publicKey),
    guests: new Set(),
    calls: [],
    // Handlers are looked up by method name; the map type is what the wire gives us.
    handlers: handlers as State['handlers'],
    hostPresent: true,
    refusal: null,
    refusedCalls: new Map(),
    version: protocolVersion,
    muted: false,
  };
  return {
    socket: () => guestSocket(state),
    boxPub: boxKeys.publicKey,
    calls: state.calls,
    guests: () => state.guests.size,
    ...boxControls(state),
  };
};
