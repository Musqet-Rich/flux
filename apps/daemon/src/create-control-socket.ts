import { guards } from '@flux/protocol';
import { unlink } from 'node:fs/promises';
import type { Server, Socket } from 'node:net';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';

// The daemon's local control socket (ADR 0008): newline-delimited JSON over a Unix socket.
// The Flux MCP server calls `ask` and `notify` on it from inside an agent session; `flux pair`
// calls `pair` and `flux devices rm` calls `devices.rm`, so a revocation reaches the live
// channels. Nothing here is reachable from outside the box.

export type ControlRequest =
  | { type: 'ask'; session: string; question: string; options?: string[]; timeoutMs?: number }
  | { type: 'notify'; session: string; summary: string; level: 'info' | 'done' | 'blocked' }
  | { type: 'compact'; session: string; focus?: string }
  | { type: 'pair' }
  | { type: 'devices.rm'; deviceId: string };

export type ControlReply = { ok: true; result: unknown } | { ok: false; error: string };

export interface ControlSocket {
  listen: () => Promise<void>;
  close: () => Promise<void>;
}

export interface ControlSocketOptions {
  path: string;
  // `signal` aborts when the client goes away before its reply (an interrupted agent).
  handle: (request: ControlRequest, signal: AbortSignal) => Promise<unknown>;
}

const { isString, isRecord, isArrayOf, isInteger, isOneOf, isOptional } = guards;

const isRequest = (v: unknown): v is ControlRequest => {
  if (!isRecord(v)) return false;
  switch (v['type']) {
    case 'ask':
      return (
        isString(v['session']) &&
        isString(v['question']) &&
        isOptional(v['options'], (o): o is string[] => isArrayOf(o, isString)) &&
        isOptional(v['timeoutMs'], (n): n is number => isInteger(n, 1))
      );
    case 'notify':
      return (
        isString(v['session']) &&
        isString(v['summary']) &&
        isOneOf(v['level'], ['info', 'done', 'blocked'])
      );
    case 'compact':
      return (
        isString(v['session']) &&
        v['session'] !== '' &&
        isOptional(v['focus'], (s): s is string => isString(s) && s !== '')
      );
    case 'pair':
      return true;
    case 'devices.rm':
      return isString(v['deviceId']);
    default:
      return false;
  }
};

const parse = (line: string): ControlRequest | null => {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRequest(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const serve = (socket: Socket, handle: ControlSocketOptions['handle']): void => {
  const reply = (message: ControlReply): void => {
    socket.write(`${JSON.stringify(message)}\n`);
  };
  socket.on('error', () => {});
  const gone = new AbortController();
  socket.on('close', () => {
    gone.abort();
  });
  // readline re-emits the socket's errors on the Interface; a client that hangs up mid-line
  // (an interrupted agent) must not take the daemon down with an unhandled ECONNRESET.
  const lines = createInterface({ input: socket });
  lines.on('error', () => {});
  lines.on('line', (line) => {
    const request = parse(line);
    if (request === null) {
      reply({ ok: false, error: 'bad request' });
      return;
    }
    handle(request, gone.signal)
      .then((result) => {
        reply({ ok: true, result });
        return null;
      })
      .catch((error: unknown) => {
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
  });
};

export const createControlSocket = (options: ControlSocketOptions): ControlSocket => {
  // Open connections are agents blocked in `ask`; `server.close` alone would wait for them.
  const open = new Set<Socket>();
  const server: Server = createServer((socket) => {
    open.add(socket);
    socket.once('close', () => {
      open.delete(socket);
    });
    serve(socket, options.handle);
  });
  return {
    listen: async () => {
      // A stale socket file from a previous run would refuse the bind.
      await unlink(options.path).catch(() => null);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.path, () => {
          resolve();
        });
      });
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
};
