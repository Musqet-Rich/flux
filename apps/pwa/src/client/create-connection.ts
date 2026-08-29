import type { Bytes, Channel, Ephemeral, FluxEvent, KeyPair } from '@flux/protocol';
import { bytes, protocolVersion, relayMessage, room, wire } from '@flux/protocol';

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
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

interface State {
  options: ConnectionOptions;
  roomId: string;
  status: ConnectionStatus;
  socket: Socket | null;
  joined: boolean;
  handshake: DeviceHandshake | null;
  channel: Channel | null;
  backoffMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: { resolve: () => void; reject: (e: ClientError) => void }[];
  rpc: ReturnType<typeof createRpcClient>;
}

const wsUrl = (relayUrl: string, roomId: string): string => {
  const url = new URL(relayUrl);
  url.protocol =
    url.protocol === 'http:' ? 'ws:' : url.protocol === 'https:' ? 'wss:' : url.protocol;
  url.pathname = `/ws/${roomId}`;
  url.hash = '';
  return url.toString();
};

const setStatus = (state: State, status: ConnectionStatus): void => {
  if (state.status === status) return;
  state.status = status;
  state.options.onStatus?.(status);
  if (status === 'connected') {
    for (const waiter of state.waiters.splice(0)) waiter.resolve();
  }
};

const dropChannel = (state: State, reason: string): void => {
  state.channel = null;
  state.handshake = null;
  state.rpc.rejectAll(new ClientError('offline', reason));
};

const sendHello = async (state: State): Promise<void> => {
  const { options, roomId } = state;
  const hs = await deviceHandshake({ keys: options.keys, boxPub: options.boxPub, roomId });
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

const onBinary = async (state: State, data: Bytes): Promise<void> => {
  if (state.channel !== null) {
    const plaintext = await state.channel.open(data);
    if (plaintext !== null) dispatch(state, plaintext);
    return;
  }
  if (state.handshake === null) return;
  const channel = await state.handshake.complete(data);
  if (channel === null) return;
  state.channel = channel;
  state.backoffMs = state.options.minBackoffMs ?? 1000;
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

const open = (state: State): void => {
  setStatus(state, 'connecting');
  state.joined = false;
  const socket = state.options.socket(wsUrl(state.options.relayUrl, state.roomId));
  state.socket = socket;
  socket.on({
    open: () => {
      socket.send(JSON.stringify({ v: protocolVersion, role: 'guest' }));
    },
    message: (data) => {
      if (typeof data === 'string') onText(state, data);
      else
        void onBinary(state, data).catch(() => {
          socket.close();
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

export const createConnection = async (options: ConnectionOptions): Promise<Connection> => {
  const state: State = {
    options,
    roomId: await room.id(options.boxPub),
    status: 'stopped',
    socket: null,
    joined: false,
    handshake: null,
    channel: null,
    backoffMs: options.minBackoffMs ?? 1000,
    timer: null,
    waiters: [],
    rpc: createRpcClient({
      send: (message) => {
        send(state, message);
      },
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
      if (state.channel === null) {
        return Promise.reject(new ClientError('offline', 'not connected'));
      }
      return state.rpc.call(method, params);
    },
    status: () => state.status,
    connected: () => connected(state),
  };
};
