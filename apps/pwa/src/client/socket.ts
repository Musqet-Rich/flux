import type { Bytes } from '@flux/protocol';

// The slice of WebSocket the connection needs, so tests can substitute an in-memory pair.

export interface SocketHandlers {
  open: () => void;
  message: (data: string | Bytes) => void;
  close: () => void;
}

export interface Socket {
  send: (data: string | Bytes) => void;
  close: () => void;
  on: (handlers: SocketHandlers) => void;
}

export type SocketFactory = (url: string) => Socket;

// Adapts the browser's WebSocket. Errors surface as a close; the connection reconnects.
export const socket: SocketFactory = (url) => {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  return {
    send: (data) => {
      ws.send(data);
    },
    close: () => {
      ws.close();
    },
    on: (handlers) => {
      ws.addEventListener('open', () => {
        handlers.open();
      });
      ws.addEventListener('message', (event: MessageEvent<unknown>) => {
        const { data } = event;
        if (typeof data === 'string') handlers.message(data);
        else if (data instanceof ArrayBuffer) handlers.message(new Uint8Array(data));
      });
      ws.addEventListener('close', () => {
        handlers.close();
      });
      ws.addEventListener('error', () => {
        ws.close();
      });
    },
  };
};
