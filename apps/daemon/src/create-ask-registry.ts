// Pending `flux_ask` questions (architecture.md § Flux tools). The MCP tool blocks on `ask`
// until the operator answers from a device or the timeout fires; either way exactly one answer
// is delivered, and the caller is told which.

export interface Answer {
  answer: string;
  by: 'device' | 'timeout';
}

export interface AskRegistry {
  ask: (askId: string, timeoutMs: number) => Promise<Answer>;
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
    ask: (askId, timeoutMs) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle(askId, { answer: '', by: 'timeout' });
        }, timeoutMs);
        pending.set(askId, { resolve, timer });
      }),
    answer: (askId, answer) => settle(askId, { answer, by: 'device' }),
    pending: () => [...pending.keys()],
    close: () => {
      // Deleting during iteration is safe for a Map: removed keys are simply not visited.
      for (const askId of pending.keys()) settle(askId, { answer: '', by: 'timeout' });
    },
  };
};
