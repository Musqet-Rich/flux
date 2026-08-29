import type { Bytes, Channel, Ephemeral, FluxEvent, KeyPair } from '@flux/protocol';
import {
  ProtocolError,
  bytes,
  protocolVersion,
  relayEndpoint,
  relayMessage,
  room,
  wire,
} from '@flux/protocol';

import { ClientError } from './client-error.ts';
import type { RpcCall } from './create-rpc-client.ts';
import { createRpcClient } from './create-rpc-client.ts';
import type { DeviceHandshake } from './device-handshake.ts';
import { deviceHandshake } from './device-handshake.ts';
import type { Socket, SocketFactory } from './socket.ts';

// The device's link to its box through the relay (protocol.md § 2–4): join the room as guest,
// handshake when a host is present, then encrypted wire messages both ways. Reconnects with
// backoff; every drop rejects the calls in flight so callers can retry after `connected`.

export type ConnectionStatus = 'stopped' | 'connecting' | 'no_host' | 'connected';

export interface Connection {
  start: () => void;
  stop: () => void;
  call: RpcCall;
  status: () => ConnectionStatus;
  // Resolves when the channel is (next) up; rejects if stopped first.
  connected: () => Promise<void>;
}

export interface ConnectionOptions {
  relayUrl: string;
  keys: KeyPair;
  boxPub: Bytes;
  socket: SocketFactory;
  onEvent: (event: FluxEvent) => void;
  onEphemeral: (data: Ephemeral) => void;
  onStatus?: (status: ConnectionStatus) => void;
  // A handshake that cannot succeed until someone acts (the box on another protocol version):
  // the connection keeps retrying at the full backoff, and this says why to the operator.
  onError?: (error: ClientError) => void;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  keepaliveMs?: number;
  rpcTimeoutMs?: number;
}

interface State {
  options: ConnectionOptions;
  url: string;
  status: ConnectionStatus;
  socket: Socket | null;
  joined: boolean;
  handshake: DeviceHandshake | null;
  channel: Channel | null;
  // Calls on the channel, bound to its socket; `null` while there is no channel.
  call: RpcCall | null;
  backoffMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  keepalive: ReturnType<typeof setInterval> | null;
  waiters: { resolve: () => void; reject: (e: ClientError) => void }[];
  rpc: ReturnType<typeof createRpcClient>;
}

const defaultKeepaliveMs = 60_000;

const setStatus = (state: State, status: ConnectionStatus): void => {
  if (state.status === status) return;
  state.status = status;
  state.options.onStatus?.(status);
  if (status === 'connected') {
    for (const waiter of state.waiters.splice(0)) waiter.resolve();
  }
};

// The device's first data frame is its `hello`, and the box's key confirmation (protocol.md
// § 3): a box that derived other keys drops the channel and answers nothing. So a `hello` that
// times out, the first one or a keepalive, means this channel is dead, not slow: the socket is
// closed for a fresh handshake rather than kept up with a channel that never decrypts. Any
// answer, an error included, confirms the keys; other methods may take as long as they take.
const callOn = (state: State, socket: Socket): RpcCall => {
  const dead = (error: unknown): boolean =>
    error instanceof ClientError && error.code === 'timeout' && state.socket === socket;
  return (method, params) => {
    const result = state.rpc.call(method, params);
    if (method === 'hello') {
      void result.catch((error: unknown) => {
        if (dead(error)) socket.close();
      });
    }
    return result;
  };
};

// The box keeps a channel per handshake and, since the relay never tells it a guest left,
// drops the one it heard from least recently once a device is past the relay's guest cap
// (protocol.md § 3, Handshake). A tab that only watches would be that one, so every tab says
// hello now and then; the reply is not needed, being heard is.
const keepAlive = (state: State): void => {
  if (state.keepalive !== null) clearInterval(state.keepalive);
  state.keepalive = setInterval(() => {
    void state.call?.('hello', { protocol: protocolVersion }).catch(() => null);
  }, state.options.keepaliveMs ?? defaultKeepaliveMs);
};

const dropChannel = (state: State, reason: string): void => {
  if (state.keepalive !== null) clearInterval(state.keepalive);
  state.keepalive = null;
  state.channel = null;
  state.call = null;
  state.handshake = null;
  state.rpc.rejectAll(new ClientError('offline', reason));
};

const sendHello = async (state: State): Promise<void> => {
  const { options } = state;
  const hs = await deviceHandshake({ keys: options.keys, boxPub: options.boxPub });
  state.handshake = hs;
  state.socket?.send(hs.frame);
};

const onText = (state: State, text: string): void => {
  const message: unknown = JSON.parse(text);
  if (!state.joined) {
    if (!relayMessage.isJoinReply(message) || !message.ok) {
      // A refused join is not transient; back off fully before trying again.
      state.backoffMs = state.options.maxBackoffMs ?? 30_000;
      state.socket?.close();
      return;
    }
    state.joined = true;
    void sendHello(state);
    return;
  }
  if (!relayMessage.isControl(message)) return;
  if (message.type === 'host_joined') void sendHello(state);
  else {
    dropChannel(state, `relay: ${message.type}`);
    setStatus(state, 'no_host');
  }
};

const dispatch = (state: State, plaintext: Bytes): void => {
  const message: unknown = JSON.parse(bytes.toUtf8(plaintext));
  if (!wire.is(message)) return;
  if (message.kind === 'event') state.options.onEvent(message.event);
  else if (message.kind === 'ephemeral') state.options.onEphemeral(message.data);
  else state.rpc.receive(message);
};

// The relay broadcasts every frame the box sends to every guest. Once this channel is up,
// a frame that is not for it is not only one with another device's fingerprint (`null`): a
// box hello for a guest handshaking after us, or a frame sealed for another tab of this same
// device (same fingerprint, its own keys and counters), fails to open with a ProtocolError.
// Those are dropped, as the box drops frames that open on none of a device's channels
// (protocol.md § 3, Handshake); anything else is ours and is fatal.
const openOnChannel = async (channel: Channel, data: Bytes): Promise<Bytes | null> => {
  try {
    return await channel.open(data);
  } catch (error) {
    if (error instanceof ProtocolError) return null;
    throw error;
  }
};

const onBinary = async (state: State, socket: Socket, data: Bytes): Promise<void> => {
  if (state.channel !== null) {
    const plaintext = await openOnChannel(state.channel, data);
    if (plaintext !== null) dispatch(state, plaintext);
    return;
  }
  if (state.handshake === null) return;
  const channel = await state.handshake.complete(data);
  if (channel === null) return;
  state.channel = channel;
  state.call = callOn(state, socket);
  state.backoffMs = state.options.minBackoffMs ?? 1000;
  keepAlive(state);
  setStatus(state, 'connected');
};

const scheduleReconnect = (state: State): void => {
  if (state.status === 'stopped' || state.timer !== null) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    open(state);
  }, state.backoffMs);
  state.backoffMs = Math.min(state.options.maxBackoffMs ?? 30_000, state.backoffMs * 2);
};

// A handshake the box answered but that cannot complete (its protocol version is not ours)
// is not transient: report it, back off fully and reconnect, in case the box gets updated.
const failHandshake = (state: State, socket: Socket, error: unknown): void => {
  if (error instanceof ClientError && error.code === 'bad_version') {
    state.options.onError?.(error);
    state.backoffMs = state.options.maxBackoffMs ?? 30_000;
  }
  socket.close();
};

const open = (state: State): void => {
  setStatus(state, 'connecting');
  state.joined = false;
  const socket = state.options.socket(state.url);
  state.socket = socket;
  socket.on({
    open: () => {
      socket.send(JSON.stringify({ v: protocolVersion, role: 'guest' }));
    },
    message: (data) => {
      if (typeof data === 'string') onText(state, data);
      else
        void onBinary(state, socket, data).catch((error: unknown) => {
          failHandshake(state, socket, error);
        });
    },
    close: () => {
      if (state.socket !== socket) return;
      state.socket = null;
      dropChannel(state, 'socket closed');
      if (state.status !== 'stopped') {
        setStatus(state, 'connecting');
        scheduleReconnect(state);
      }
    },
  });
};

const send = (state: State, message: unknown): void => {
  const { channel, socket } = state;
  if (channel === null || socket === null) {
    throw new ClientError('offline', 'not connected');
  }
  void channel
    .seal(bytes.fromUtf8(JSON.stringify(message)))
    .then((sealed) => {
      socket.send(sealed);
      return null;
    })
    .catch(() => {
      socket.close();
    });
};

const stop = (state: State): void => {
  setStatus(state, 'stopped');
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  const { socket } = state;
  state.socket = null;
  socket?.close();
  dropChannel(state, 'stopped');
  for (const waiter of state.waiters.splice(0)) {
    waiter.reject(new ClientError('offline', 'stopped'));
  }
};

const connected = (state: State): Promise<void> => {
  if (state.status === 'connected') return Promise.resolve();
  if (state.status === 'stopped') return Promise.reject(new ClientError('offline', 'stopped'));
  return new Promise((resolve, reject) => {
    state.waiters.push({ resolve, reject });
  });
};

// The room's WebSocket URL, or `insecure_transport` for a plaintext relay off loopback
// (protocol.md § 2): a pairing link with such an origin is refused before any socket opens.
const endpoint = (relayUrl: string, roomId: string): string => {
  try {
    return relayEndpoint.websocket(relayUrl, roomId);
  } catch (error) {
    if (error instanceof ProtocolError) throw new ClientError(error.code, error.message);
    throw error;
  }
};

export const createConnection = async (options: ConnectionOptions): Promise<Connection> => {
  const roomId = await room.id(options.boxPub);
  const state: State = {
    options,
    url: endpoint(options.relayUrl, roomId),
    status: 'stopped',
    socket: null,
    joined: false,
    handshake: null,
    channel: null,
    call: null,
    backoffMs: options.minBackoffMs ?? 1000,
    timer: null,
    keepalive: null,
    waiters: [],
    rpc: createRpcClient({
      send: (message) => {
        send(state, message);
      },
      ...(options.rpcTimeoutMs === undefined ? {} : { timeoutMs: options.rpcTimeoutMs }),
    }),
  };
  return {
    start: () => {
      if (state.status === 'stopped') open(state);
    },
    stop: () => {
      stop(state);
    },
    call: (method, params) => {
      if (state.call === null) {
        return Promise.reject(new ClientError('offline', 'not connected'));
      }
      return state.call(method, params);
    },
    status: () => state.status,
    connected: () => connected(state),
  };
};
