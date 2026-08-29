import type { RpcCall } from './create-rpc-client.ts';
import type { SessionLog } from './create-session-log.ts';

// Pulls everything after the log's lastSeq from the box, page by page, until complete
// (architecture.md § Sync model). Safe to call repeatedly; a concurrent call is coalesced.

export interface SyncSession {
  (log: SessionLog): Promise<void>;
}

export const syncSession = (call: RpcCall): SyncSession => {
  const inFlight = new Map<string, Promise<void>>();
  const pull = async (log: SessionLog): Promise<void> => {
    const page = await call('events.sync', { session: log.session, since: log.lastSeq() });
    log.applyPage(page.events);
    if (!page.complete && page.events.length > 0) await pull(log);
  };
  return (log) => {
    const running = inFlight.get(log.session);
    if (running !== undefined) return running;
    const started = pull(log).finally(() => {
      inFlight.delete(log.session);
    });
    inFlight.set(log.session, started);
    return started;
  };
};
