import type { RpcCall } from './create-rpc-client.ts';
import type { SessionLog } from './create-session-log.ts';

// Pulls everything after the log's lastSeq from the box, page by page, until complete
// (architecture.md § Sync model). Safe to call repeatedly: a call during a pull is coalesced
// into it, and because that pull's pages may predate whatever prompted the call, the session
// is marked dirty and pulled once more when it finishes.

export interface SyncSession {
  (log: SessionLog): Promise<void>;
}

export const syncSession = (call: RpcCall): SyncSession => {
  const inFlight = new Map<string, Promise<void>>();
  const dirty = new Set<string>();
  const pull = async (log: SessionLog): Promise<void> => {
    const page = await call('events.sync', { session: log.session, since: log.lastSeq() });
    log.applyPage(page.events);
    if (!page.complete && page.events.length > 0) await pull(log);
  };
  const run = async (log: SessionLog): Promise<void> => {
    dirty.delete(log.session);
    await pull(log);
    if (dirty.has(log.session)) await run(log);
  };
  return (log) => {
    const running = inFlight.get(log.session);
    if (running !== undefined) {
      dirty.add(log.session);
      return running;
    }
    const started = run(log).finally(() => {
      inFlight.delete(log.session);
      dirty.delete(log.session);
    });
    inFlight.set(log.session, started);
    return started;
  };
};
