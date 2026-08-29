import type { Bytes } from '@flux/protocol';
import { base64url, bytes, frame, handshake } from '@flux/protocol';

// Splits the one stream of frames the host sends into a queue per device, the way the real
// relay's broadcast lets every guest see every frame and keep only its own: a box hello goes
// to the fingerprint in `to`, a data frame to the fingerprint in its header. Tests with two
// devices on the fake relay need this; one device can read the relay directly.

export interface FrameRouter {
  // Registers a device by fingerprint and returns its `next`.
  register: (fingerprint: Bytes) => () => Promise<Bytes>;
  // Frames a device has not read yet.
  pending: (fingerprint: Bytes) => number;
}

interface Queue {
  frames: Bytes[];
  waiters: ((data: Bytes) => void)[];
}

const hex = (data: Bytes): string =>
  Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

const target = (data: Bytes): string | null => {
  const decoded = frame.decode(data);
  if (decoded.kind !== frame.kind.handshake) return hex(decoded.fingerprint);
  const hello: unknown = JSON.parse(bytes.toUtf8(new Uint8Array(decoded.payload)));
  return handshake.isBoxHello(hello) ? hex(base64url.decode(hello.to)) : null;
};

export const frameRouter = (next: () => Promise<Bytes>): FrameRouter => {
  const queues = new Map<string, Queue>();
  const route = (data: Bytes): void => {
    const key = target(data);
    const queue = key === null ? undefined : queues.get(key);
    if (queue === undefined) return;
    const waiter = queue.waiters.shift();
    if (waiter) waiter(data);
    else queue.frames.push(data);
  };
  // Pulls forever; the last pull dangles when the relay closes, which is harmless.
  const pump = (): void => {
    void next().then((data) => {
      route(data);
      pump();
      return null;
    });
  };
  pump();
  return {
    register: (fingerprint) => {
      const queue: Queue = { frames: [], waiters: [] };
      queues.set(hex(fingerprint), queue);
      return () =>
        new Promise((resolve) => {
          const queued = queue.frames.shift();
          if (queued) resolve(queued);
          else queue.waiters.push(resolve);
        });
    },
    pending: (fingerprint) => queues.get(hex(fingerprint))?.frames.length ?? 0,
  };
};
