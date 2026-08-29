import { createSessionLog } from '../client/create-session-log.ts';
import { boxLink } from './box-link.ts';
import { logCache } from './log-cache.ts';
import type { StoreInternals } from './store-state.ts';

// Opening a session on the device: the cached log renders first, then a sync brings it up to
// date. Kept apart from the store's actions so that file stays small.

const open = async (i: StoreInternals, session: string): Promise<void> => {
  const existing = i.logs.get(session);
  if (existing !== undefined) return boxLink.syncLog(i, existing);
  const log = createSessionLog(session, await logCache.load(i, session));
  // Two views can open the same session before the cache read settles; the first one wins.
  const raced = i.logs.get(session);
  if (raced !== undefined) return boxLink.syncLog(i, raced);
  i.logs.set(session, log);
  logCache.publish(i, log);
  return boxLink.syncLog(i, log);
};

export const sessionLogs: { open: typeof open } = { open };
