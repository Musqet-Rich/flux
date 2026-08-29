import type { Ephemeral, FluxEvent } from '@flux/protocol';

// One session's slice of the event log on the device (architecture.md § Sync model): events in
// seq order, gapless; an event out of order is a signal to sync, never applied. Deltas are
// display hints for the assistant message that will take `forSeq`.

export type Receipt = 'applied' | 'stale' | 'gap';

export interface SessionLog {
  session: string;
  events: () => readonly FluxEvent[];
  lastSeq: () => number;
  // The assistant text streamed so far for the next message, empty once it lands.
  streaming: () => string;
  receive: (event: FluxEvent) => Receipt;
  // Applies a page from events.sync; events already held are skipped.
  applyPage: (events: FluxEvent[]) => void;
  delta: (data: Ephemeral) => void;
  // Bumps whenever anything above changes, for UIs that want a cheap dependency.
  version: () => number;
}

export const createSessionLog = (session: string, initial: FluxEvent[] = []): SessionLog => {
  const events: FluxEvent[] = [...initial];
  let streaming = { forSeq: 0, text: '' };
  let version = 0;
  const lastSeq = (): number => events.at(-1)?.seq ?? 0;
  const push = (event: FluxEvent): void => {
    events.push(event);
    if (event.seq >= streaming.forSeq) streaming = { forSeq: 0, text: '' };
    version += 1;
  };
  return {
    session,
    events: () => events,
    lastSeq,
    streaming: () => streaming.text,
    receive: (event) => {
      if (event.session !== session) return 'stale';
      if (event.seq <= lastSeq()) return 'stale';
      if (event.seq !== lastSeq() + 1) return 'gap';
      push(event);
      return 'applied';
    },
    applyPage: (page) => {
      for (const event of page) {
        if (event.session === session && event.seq === lastSeq() + 1) push(event);
      }
    },
    delta: (data) => {
      if (data.type !== 'delta' || data.session !== session || data.forSeq <= lastSeq()) return;
      streaming =
        data.forSeq === streaming.forSeq
          ? { forSeq: data.forSeq, text: streaming.text + data.text }
          : { forSeq: data.forSeq, text: data.text };
      version += 1;
    },
    version: () => version,
  };
};
