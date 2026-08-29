// Pending `flux_ask` questions (architecture.md § Flux tools). The MCP tool blocks on `ask`
// until the operator answers from a device or the timeout fires; either way exactly one answer
// is delivered, and the caller is told which.

export interface Answer {
  answer: string;
  by: 'device' | 'timeout' | 'aborted';
}

export interface AskRegistry {
  // `signal` is the asking connection: when it goes away (the agent was interrupted mid-ask),
  // the ask settles as aborted so the operator's card closes.
  ask: (askId: string, timeoutMs: number, signal?: AbortSignal) => Promise<Answer>;
  answer: (askId: string, answer: string) => boolean;
  pending: () => string[];
  close: () => void;
}

interface Pending {
  resolve: (answer: Answer) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const createAskRegistry = (): AskRegistry => {
  const pending = new Map<string, Pending>();

  const settle = (askId: string, answer: Answer): boolean => {
    const entry = pending.get(askId);
    if (entry === undefined) return false;
    clearTimeout(entry.timer);
    pending.delete(askId);
    entry.resolve(answer);
    return true;
  };

  return {
    ask: (askId, timeoutMs, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle(askId, { answer: '', by: 'timeout' });
        }, timeoutMs);
        pending.set(askId, { resolve, timer });
        signal?.addEventListener(
          'abort',
          () => {
            settle(askId, { answer: '', by: 'aborted' });
          },
          { once: true },
        );
      }),
    answer: (askId, answer) => settle(askId, { answer, by: 'device' }),
    pending: () => [...pending.keys()],
    close: () => {
      // Deleting during iteration is safe for a Map: removed keys are simply not visited.
      for (const askId of pending.keys()) settle(askId, { answer: '', by: 'timeout' });
    },
  };
};
