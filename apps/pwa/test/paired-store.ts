import type { FluxEvent, SessionSummary } from '@flux/protocol';
import { pairing } from '@flux/protocol';
import { reactive } from 'vue';

import { createMemoryStorage } from '../src/client/create-memory-storage.ts';
import type { Store } from '../src/store/create-store.ts';
import { createStore } from '../src/store/create-store.ts';
import type { FakeRelay, Handlers } from './fake-relay.ts';
import { createFakeRelay } from './fake-relay.ts';

// A store already paired with a fake box, for component tests: the box holds one session
// `s1` whose log is `events`, and answers whatever `handlers` add. Every handled call is
// recorded in a reactive list so tests can `until(() => calls('x').length === 1)`.

export interface PairedStore {
  store: Store;
  relay: FakeRelay;
  calls: (method: string) => unknown[];
  event: (seq: number, type: string, payload: unknown) => FluxEvent;
}

const recorded = (handlers: Handlers, seen: { method: string; params: unknown }[]): Handlers =>
  Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      (params: never) => {
        seen.push({ method, params });
        return handler(params);
      },
    ]),
  );

export const pairedStore = async (
  events: FluxEvent[] = [],
  handlers: Handlers = {},
): Promise<PairedStore> => {
  const session: SessionSummary = {
    session: 's1',
    title: 'First',
    repo: '/repos/r',
    branch: 'flux/one',
    agent: 'claude',
    state: 'idle',
    lastSeq: events.length,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const seen = reactive<{ method: string; params: unknown }[]>([]);
  const relay = await createFakeRelay(
    recorded(
      {
        hello: () => ({ protocol: 1, daemon: 'box', sessions: [session] }),
        'pair.request': () => ({ deviceId: 'dev-1' }),
        'events.sync': (p) => ({ events: events.filter((e) => e.seq > p.since), complete: true }),
        ...handlers,
      },
      seen,
    ),
  );
  const store = createStore({ storage: createMemoryStorage(), socket: relay.socket });
  const secret = new Uint8Array(pairing.secretLength);
  const url = pairing.url('https://relay.example', { boxPub: relay.boxPub, secret });
  await store.pair('https://relay.example', new URL(url).hash);
  return {
    store,
    relay,
    calls: (method) => seen.filter((c) => c.method === method).map((c) => c.params),
    event: (seq, type, payload) => ({
      seq,
      ts: '2026-01-01T00:00:00Z',
      session: 's1',
      type,
      payload,
    }),
  };
};
