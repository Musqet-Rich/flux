import type { FluxEvent, SessionSummary } from '@flux/protocol';
import { pairing, room } from '@flux/protocol';
import { reactive } from 'vue';

import { createMemoryStorage } from '../src/client/create-memory-storage.ts';
import { createStore } from '../src/store/create-store.ts';
import type { StoreOptions } from '../src/store/store-state.ts';
import type { Handlers } from './fake-relay.ts';
import { createFakeRelay } from './fake-relay.ts';
import { storeOptions } from './store-options.ts';

// Two fake daemons behind one relay origin, `work` and `hobby`, and a store factory over shared
// storage for the multi-daemon tests (ADR 0037). Each daemon has a session `s1` whose log is one
// event naming the daemon, so a test can tell whose log is on screen. `make` takes extra store
// options to override the recording push functions or the storage.

const summary: SessionSummary = {
  session: 's1',
  title: 'First',
  repo: '/repos/r',
  branch: 'flux/one',
  harness: 'claude',
  state: 'idle',
  lastSeq: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const event = (text: string): FluxEvent => ({
  seq: 1,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type: 'msg.user',
  payload: { text },
});

const daemon = async (name: string) => {
  const handlers: Handlers = {
    hello: () => ({ protocol: 2, daemon: name, sessions: [summary], vapidPublicKey: 'a2V5' }),
    'pair.request': () => ({ deviceId: `dev-${name}` }),
    'devices.remove': () => ({}),
    'push.subscribe': () => ({}),
    'events.sync': () => ({ events: [event(`from ${name}`)], complete: true }),
  };
  const relay = await createFakeRelay(handlers);
  const id = await room.id(relay.boxPub);
  const secret = new Uint8Array(pairing.secretLength);
  const link = new URL(pairing.url('https://relay.example', { boxPub: relay.boxPub, secret })).hash;
  const called = (method: string) => relay.calls.filter((c) => c.method === method);
  return { relay, id, link, called };
};

const setup = async () => {
  const work = await daemon('work');
  const hobby = await daemon('hobby');
  // One relay origin, a room per daemon: the socket goes to whichever room the URL names.
  const socket = (url: string) =>
    url.endsWith(work.id) ? work.relay.socket(url) : hobby.relay.socket(url);
  // Memory storage whose writes are also seen reactively, so a test can await one landing.
  const memory = createMemoryStorage();
  const written = reactive(new Map<string, unknown>());
  const storage = {
    ...memory,
    set: async (key: string, value: unknown) => {
      await memory.set(key, value);
      written.set(key, value);
    },
  };
  const pushes: string[] = [];
  const forgotten: (string | null)[] = [];
  const timers: (() => void)[] = [];
  const make = (extra: Partial<StoreOptions> = {}) =>
    createStore(
      storeOptions({
        storage,
        socket,
        minBackoffMs: 1,
        maxBackoffMs: 5,
        subscribePush: (_key, _prompt, id) => {
          pushes.push(id);
          return Promise.resolve({ endpoint: `https://push.example/${id}` });
        },
        forgetPush: (id) => {
          forgotten.push(id);
          return Promise.resolve();
        },
        schedule: (fn) => {
          timers.push(fn);
          return () => {
            timers.splice(timers.indexOf(fn), 1);
          };
        },
        ...extra,
      }),
    );
  const fire = (): void => {
    for (const fn of timers.splice(0)) fn();
  };
  return { work, hobby, storage, written, pushes, forgotten, make, fire };
};

export const twoDaemons: { setup: typeof setup; event: typeof event } = { setup, event };
