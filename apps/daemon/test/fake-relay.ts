import type { Bytes } from '@flux/protocol';
import type { WebSocket as ServerSocket } from 'ws';
import { WebSocketServer } from 'ws';

// A relay stand-in for daemon tests: accepts the host join, then lets the test play the guest
// on the same socket. `nextFrame` yields binary frames the host sends; `send` goes to the host.

export interface FakeRelay {
  url: string;
  host: () => Promise<ServerSocket>;
  nextFrame: () => Promise<Bytes>;
  send: (data: Bytes) => void;
  hosts: number;
  close: () => Promise<void>;
}

const toBytes = (data: unknown): Bytes => {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data))
    return new Uint8Array(Buffer.concat(data.filter((b) => Buffer.isBuffer(b))));
  return new Uint8Array();
};

// Binary frames from hosts, handed out in order to whoever asks next.
const createFrameQueue = () => {
  const frames: Bytes[] = [];
  const waiters: ((b: Bytes) => void)[] = [];
  return {
    push: (chunk: Bytes): void => {
      const waiter = waiters.shift();
      if (waiter) waiter(chunk);
      else frames.push(chunk);
    },
    next: (): Promise<Bytes> =>
      new Promise((resolve) => {
        const queued = frames.shift();
        if (queued) resolve(queued);
        else waiters.push(resolve);
      }),
  };
};

const untilSocket = (sockets: ServerSocket[]): Promise<ServerSocket> =>
  new Promise((resolve) => {
    const check = (): void => {
      const socket = sockets.at(-1);
      if (socket) resolve(socket);
      else setImmediate(check);
    };
    check();
  });

const portOf = (server: WebSocketServer): number => {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
};

export const startFakeRelay = async (): Promise<FakeRelay> => {
  const server = new WebSocketServer({ port: 0 });
  const sockets: ServerSocket[] = [];
  const queue = createFrameQueue();
  server.on('connection', (socket) => {
    socket.once('message', () => {
      sockets.push(socket);
      socket.send(JSON.stringify({ ok: true }));
      socket.on('message', (data, isBinary) => {
        if (isBinary) queue.push(toBytes(data));
      });
    });
  });
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  return {
    url: `http://127.0.0.1:${portOf(server)}`,
    host: () => untilSocket(sockets),
    nextFrame: queue.next,
    send: (data) => {
      sockets.at(-1)?.send(data);
    },
    get hosts() {
      return sockets.length;
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of server.clients) socket.terminate();
        server.close(() => {
          resolve();
        });
      }),
  };
};
