import type { Bytes, Channel, Wire } from '@flux/protocol';
import { base64url, bytes, handshake, pairing, room } from '@flux/protocol';
import { connect } from 'node:net';

import type { Daemon } from '../src/create-daemon.ts';
import { deviceHandshake } from './device-side.ts';
import type { FakeRelay } from './fake-relay.ts';
import type { FrameRouter } from './frame-router.ts';

// The device side of a daemon test: pairs over the fake relay, calls rpcs, reads events. The
// daemon, relay and router are looked up per call because a test file makes fresh ones per test.

export interface Dev {
  keys: Awaited<ReturnType<typeof handshake.generateKeyPair>>;
  payload: NonNullable<ReturnType<typeof pairing.parse>>;
  channel: Channel;
  next: () => Promise<Bytes>;
  fingerprint: Bytes;
}

export interface DaemonDeviceContext {
  daemon: () => Daemon;
  relay: () => FakeRelay;
  frames: () => FrameRouter;
}

export interface DaemonDevice {
  // A device: parses a fresh pairing URL, handshakes over the fake relay, returns an rpc
  // caller. `keys` lets a device come back with the identity it had.
  device: (keys?: Dev['keys']) => Promise<Dev>;
  open: (channel: Channel, data: Bytes) => Promise<Wire | null>;
  untilMatch: (d: Dev, match: (m: Wire) => boolean) => Promise<Wire>;
  // Sends an rpc and returns its result, skipping any events broadcast in between.
  call: (d: Dev, method: string, params: unknown) => Promise<unknown>;
  untilEvent: (d: Dev, type: string) => Promise<Wire>;
  untilRevoked: (d: Dev) => Promise<Wire>;
  // What `flux devices rm` does: one line to the control socket, one line back.
  controlRm: (deviceId: string) => Promise<unknown>;
  pair: (d: Dev) => Promise<string>;
  // Reads each device's frames until it has seen `wanted[i]` messages: what each device sees,
  // in the order it sees it. A frame out of nonce order makes `open` throw, which fails the test.
  collect: (devs: Dev[], wanted: number[]) => Promise<Wire[][]>;
}

const open = async (channel: Channel, data: Bytes): Promise<Wire | null> => {
  const plain = await channel.open(data);
  return plain === null ? null : (JSON.parse(bytes.toUtf8(plain)) as Wire);
};

// Reads frames until one decrypts to a message the predicate accepts (recursion, not a loop:
// every frame is awaited in turn, which is the point).
const untilMatch = async (d: Dev, match: (m: Wire) => boolean): Promise<Wire> => {
  const message = await open(d.channel, await d.next());
  return message !== null && match(message) ? message : untilMatch(d, match);
};

const untilEvent = (d: Dev, type: string): Promise<Wire> =>
  untilMatch(d, (m) => m.kind === 'event' && m.event.type === type);

const untilRevoked = (d: Dev): Promise<Wire> =>
  untilMatch(d, (m) => m.kind === 'ephemeral' && m.data.type === 'device.revoked');

const device =
  (context: DaemonDeviceContext) =>
  async (keys?: Dev['keys']): Promise<Dev> => {
    const url = context.daemon().pairingUrl();
    const payload = pairing.parse(new URL(url).hash);
    if (payload === null) throw new Error('bad pairing url');
    const own = keys ?? (await handshake.generateKeyPair(true));
    const fingerprint = await room.fingerprint(own.publicKey);
    const next = context.frames().register(fingerprint);
    const channel = await deviceHandshake({
      keys: own,
      boxPub: payload.boxPub,
      roomId: await room.id(payload.boxPub),
      send: context.relay().send,
      next,
    });
    return { keys: own, payload, channel, next, fingerprint };
  };

const call =
  (context: DaemonDeviceContext) =>
  async (d: Dev, method: string, params: unknown): Promise<unknown> => {
    const id = crypto.randomUUID();
    const rpc: Wire = { kind: 'rpc', id, method, params };
    context.relay().send(await d.channel.seal(bytes.fromUtf8(JSON.stringify(rpc))));
    const message = await untilMatch(d, (m) => m.kind === 'rpc.result' && m.id === id);
    if (message.kind !== 'rpc.result') throw new Error('unreachable');
    if (message.ok) return message.result;
    throw new Error(`${message.error.code}: ${message.error.message}`);
  };

const controlRm =
  (context: DaemonDeviceContext) =>
  (deviceId: string): Promise<unknown> =>
    new Promise((resolve) => {
      const client = connect(context.daemon().controlSocket, () => {
        client.write(`${JSON.stringify({ type: 'devices.rm', deviceId })}\n`);
      });
      client.once('data', (chunk: Buffer) => {
        client.end();
        resolve(JSON.parse(chunk.toString()));
      });
    });

const pair =
  (context: DaemonDeviceContext) =>
  async (d: Dev): Promise<string> => {
    const proof = await pairing.proof(d.payload.secret, d.keys.publicKey, d.payload.boxPub);
    const paired = (await call(context)(d, 'pair.request', {
      devPub: base64url.encode(d.keys.publicKey),
      proof: base64url.encode(proof),
    })) as { deviceId: string };
    return paired.deviceId;
  };

const collect = (devs: Dev[], wanted: number[]): Promise<Wire[][]> =>
  Promise.all(
    devs.map(async (d, i) => {
      const seen: Wire[] = [];
      const step = async (): Promise<Wire[]> => {
        if (seen.length >= (wanted[i] ?? 0)) return seen;
        const message = await open(d.channel, await d.next());
        if (message !== null) seen.push(message);
        return step();
      };
      return step();
    }),
  );

export const daemonDevice = (context: DaemonDeviceContext): DaemonDevice => ({
  device: device(context),
  open,
  untilMatch,
  call: call(context),
  untilEvent,
  untilRevoked,
  controlRm: controlRm(context),
  pair: pair(context),
  collect,
});
