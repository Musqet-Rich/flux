import type { RelayJoinReply } from '@flux/protocol';
import { guards, protocolVersion, relayMessage } from '@flux/protocol';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

import { createRateLimiter } from './create-rate-limiter.ts';
import type { Peer, Rooms } from './create-rooms.ts';
import { createRooms } from './create-rooms.ts';

// The relay (architecture.md § Relay, protocol.md § 2): serves the PWA, forwards opaque frames
// between a room's host and guests. It logs nothing that identifies a room or an address.

export interface RelayServerOptions {
  pwaDir: string;
  maxFrameBytes?: number;
  maxGuests?: number;
  connectionsPerMinute?: number;
  joinTimeoutMs?: number;
}

export interface RelayServer {
  listen: (port: number, hostname?: string) => Promise<number>;
  close: () => Promise<void>;
}

// engineering.md § Security. `wss:` for the relay itself; `data:` for QR and icons.
const csp = "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:";
const roomPath = /^\/ws\/([A-Za-z0-9_-]{22})$/u;
const closeCodes = { policy: 1008, tooLarge: 1009, protocol: 1002 } as const;

const toBytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
};

const parseJoin = (data: RawData, isBinary: boolean): unknown => {
  if (isBinary) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(toBytes(data)));
  } catch {
    return undefined;
  }
};

const peerOf = (socket: WebSocket): Peer => ({
  send: (data) => {
    if (socket.readyState === socket.OPEN) socket.send(data);
  },
  close: () => {
    socket.close(closeCodes.policy);
  },
});

const reply = (socket: WebSocket, message: RelayJoinReply): void => {
  socket.send(JSON.stringify(message));
};

// The first message must be the join, in text, within the timeout; after that everything is
// opaque binary and any text frame is a protocol violation.
const attach = (socket: WebSocket, roomId: string, rooms: Rooms, joinTimeoutMs: number): void => {
  const timer = setTimeout(() => {
    socket.close(closeCodes.policy);
  }, joinTimeoutMs);
  // ws reports an oversize frame as an error before closing with 1009; nothing else to do.
  socket.on('error', () => {});
  socket.once('message', (data, isBinary) => {
    clearTimeout(timer);
    const parsed = parseJoin(data, isBinary);
    if (!relayMessage.isJoin(parsed)) {
      if (guards.isRecord(parsed) && parsed['v'] !== protocolVersion) {
        reply(socket, { ok: false, error: 'bad_version' });
        socket.close(closeCodes.policy);
      } else {
        socket.close(closeCodes.protocol);
      }
      return;
    }
    const result = rooms.join(roomId, parsed, peerOf(socket));
    if (!result.ok) {
      reply(socket, { ok: false, error: result.error });
      socket.close(closeCodes.policy);
      return;
    }
    const { membership } = result;
    reply(socket, { ok: true });
    socket.on('message', (frame, binary) => {
      if (binary) membership.forward(toBytes(frame));
      else socket.close(closeCodes.protocol);
    });
    socket.once('close', () => {
      membership.leave();
    });
  });
};

const createApp = (pwaDir: string): Hono => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    await next();
    c.header('Content-Security-Policy', csp);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.use('/*', serveStatic({ root: pwaDir }));
  // Single-page app: any other GET is the shell, which routes on the client.
  app.get('*', serveStatic({ root: pwaDir, path: 'index.html' }));
  return app;
};

const listenOn = (server: Server, port: number, hostname: string): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => {
      const bound = server.address();
      resolve(typeof bound === 'object' && bound !== null ? bound.port : port);
    });
  });

export const createRelayServer = (options: RelayServerOptions): RelayServer => {
  const rooms = createRooms({ maxGuests: options.maxGuests ?? 8 });
  const limiter = createRateLimiter({
    limit: options.connectionsPerMinute ?? 30,
    windowMs: 60_000,
  });
  const joinTimeoutMs = options.joinTimeoutMs ?? 5000;
  const listener = getRequestListener(createApp(options.pwaDir).fetch);
  // The listener's promise is its own error boundary; node:http wants a void callback.
  const server: Server = createServer((req, res) => {
    void listener(req, res);
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxFrameBytes ?? 1024 * 1024,
  });

  server.on('upgrade', (request, socket, head) => {
    const roomId = roomPath.exec(request.url ?? '')?.[1];
    if (roomId === undefined || !limiter.allow(request.socket.remoteAddress ?? '')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      attach(ws, roomId, rooms, joinTimeoutMs);
    });
  });

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

  return { listen: (port, hostname = '127.0.0.1') => listenOn(server, port, hostname), close };
};
