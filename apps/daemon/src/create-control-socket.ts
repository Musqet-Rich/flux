import { guards } from '@flux/protocol';
import { unlink } from 'node:fs/promises';
import type { Server, Socket } from 'node:net';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';

// The daemon's local control socket (ADR 0008): newline-delimited JSON over a Unix socket.
// The Flux MCP server calls `ask` and `notify` on it from inside an agent session; `flux pair`
// calls `pair`. Nothing here is reachable from outside the box.

export type ControlRequest =
  | { type: 'ask'; session: string; question: string; options?: string[]; timeoutMs?: number }
  | { type: 'notify'; session: string; summary: string; level: 'info' | 'done' | 'blocked' }
  | { type: 'pair' };

export type ControlReply = { ok: true; result: unknown } | { ok: false; error: string };

export interface ControlSocket {
  listen: () => Promise<void>;
  close: () => Promise<void>;
}

export interface ControlSocketOptions {
  path: string;
  handle: (request: ControlRequest) => Promise<unknown>;
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
    case 'pair':
      return true;
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
  createInterface({ input: socket }).on('line', (line) => {
    const request = parse(line);
    if (request === null) {
      reply({ ok: false, error: 'bad request' });
      return;
    }
    handle(request)
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
  const server: Server = createServer((socket) => {
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
        server.close(() => {
          resolve();
        });
      }),
  };
};
