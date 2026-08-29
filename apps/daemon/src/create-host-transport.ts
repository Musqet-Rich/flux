import type { Bytes, Wire } from '@flux/protocol';
import { protocolVersion, relayEndpoint, relayMessage } from '@flux/protocol';

import type { DeviceChannels } from './create-device-channels.ts';

// The box's one outbound connection (architecture.md § Daemon, Transport; protocol.md § 2):
// join the room as host, hand every binary frame to the device channels, reconnect with backoff
// for as long as the daemon runs. The platform WebSocket is the client; `ws` is server side only.

export type TransportStatus = 'stopped' | 'connecting' | 'connected';

export interface HostTransport {
  // Throws `insecure_transport` (ProtocolError) for a plaintext relay off loopback.
  start: () => void;
  stop: () => void;
  status: () => TransportStatus;
  broadcast: (message: Wire) => Promise<void>;
  sendTo: (fingerprint: string, message: Wire) => Promise<boolean>;
  // Drops every live channel of a revoked device after telling it so.
  revoke: (deviceId: string) => Promise<void>;
}

export interface HostTransportOptions {
  relayUrl: string;
  roomId: string;
  token: string;
  channels: DeviceChannels;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  onStatus?: (status: TransportStatus) => void;
}

interface State {
  options: HostTransportOptions;
  // The room's WebSocket URL, resolved at `start` (protocol.md § 2: plaintext only to loopback),
  // so a bad `FLUX_RELAY_URL` fails the daemon's start rather than every reconnect, and a
  // command that never connects (`flux devices`) needs no URL at all.
  url: string | null;
  socket: WebSocket | null;
  status: TransportStatus;
  stopped: boolean;
  backoffMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  // Incoming frames are handled one at a time so each channel's nonce counters stay ordered.
  queue: Promise<void>;
}

const setStatus = (state: State, status: TransportStatus): void => {
  if (state.status === status) return;
  state.status = status;
  state.options.onStatus?.(status);
};

const send = (state: State, data: Bytes): void => {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(data);
};

const scheduleReconnect = (state: State): void => {
  if (state.stopped || state.timer !== null) return;
  const max = state.options.maxBackoffMs ?? 30_000;
  state.timer = setTimeout(() => {
    state.timer = null;
    connect(state);
  }, state.backoffMs);
  state.backoffMs = Math.min(max, state.backoffMs * 2);
};

const onText = (state: State, text: string): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (relayMessage.isJoinReply(parsed)) {
    if (parsed.ok) {
      state.backoffMs = state.options.minBackoffMs ?? 1000;
      setStatus(state, 'connected');
    } else {
      // A refused join is not transient; wait the full backoff before trying again. Said on
      // the console because nothing else can show it: no device can reach a box the relay
      // turned away, and `bad_version` means one side of the deployment is behind.
      console.error(
        `flux daemon: relay refused join: ${parsed.error}` +
          (parsed.error === 'bad_version'
            ? ` (this daemon speaks protocol ${protocolVersion}; update the relay or the daemon)`
            : ''),
      );
      state.backoffMs = state.options.maxBackoffMs ?? 30_000;
    }
  }
  // Control frames (host_joined, host_left, no_host) are for guests; the host ignores them.
};

const onMessage = (state: State, data: unknown): void => {
  if (typeof data === 'string') {
    onText(state, data);
    return;
  }
  if (!(data instanceof ArrayBuffer)) return;
  const frameBytes = new Uint8Array(data);
  state.queue = state.queue.then(() =>
    state.options.channels.handleFrame(frameBytes, (out) => {
      send(state, out);
    }),
  );
};

const connect = (state: State): void => {
  if (state.stopped) return;
  setStatus(state, 'connecting');
  if (state.url === null) return;
  const socket = new WebSocket(state.url);
  socket.binaryType = 'arraybuffer';
  state.socket = socket;
  socket.addEventListener('open', () => {
    const join = { v: protocolVersion, role: 'host', token: state.options.token };
    socket.send(JSON.stringify(join));
  });
  socket.addEventListener('message', (event: MessageEvent) => {
    onMessage(state, event.data);
  });
  socket.addEventListener('error', () => {});
  socket.addEventListener('close', () => {
    if (state.socket !== socket) return;
    state.socket = null;
    state.options.channels.reset();
    setStatus(state, state.stopped ? 'stopped' : 'connecting');
    scheduleReconnect(state);
  });
};

export const createHostTransport = (options: HostTransportOptions): HostTransport => {
  const state: State = {
    options,
    url: null,
    socket: null,
    status: 'stopped',
    stopped: true,
    backoffMs: options.minBackoffMs ?? 1000,
    timer: null,
    queue: Promise.resolve(),
  };
  const out = (data: Bytes): void => {
    send(state, data);
  };
  return {
    start: () => {
      if (!state.stopped) return;
      state.url = relayEndpoint.websocket(options.relayUrl, options.roomId);
      state.stopped = false;
      connect(state);
    },
    stop: () => {
      state.stopped = true;
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = null;
      state.socket?.close();
      state.socket = null;
      options.channels.reset();
      setStatus(state, 'stopped');
    },
    status: () => state.status,
    broadcast: (message) => options.channels.broadcast(message, out),
    sendTo: (fingerprint, message) => options.channels.sendTo(fingerprint, message, out),
    revoke: (deviceId) => options.channels.revoke(deviceId, out),
  };
};
