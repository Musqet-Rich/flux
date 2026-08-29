import type { ErrorKind, StoreInternals } from './store-state.ts';

// `state.error` for the status bar. An action's failure (a send, a git action, a settings save)
// is news for a moment and goes on its own after `actionErrorMs`, or sooner when the next
// action succeeds or the operator dismisses it. A connection failure (pairing refused, the box
// forgot this device, hello failed) describes a standing condition and stays until it clears
// or is dismissed. The timer is injected so tests fire it rather than wait.

const actionErrorMs = 8000;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => {
    clearTimeout(timer);
  };
};

const clear = (i: StoreInternals): void => {
  i.errorTimer?.();
  i.errorTimer = null;
  i.state.error = null;
};

// Replaces the shown error; a fresh one restarts the clock so it gets its full time on screen.
const report = (i: StoreInternals, error: unknown, kind: ErrorKind = 'action'): void => {
  clear(i);
  i.state.error = { message: error instanceof Error ? error.message : String(error), kind };
  if (kind !== 'action') return;
  const schedule = i.options.schedule ?? defaultSchedule;
  i.errorTimer = schedule(() => {
    i.errorTimer = null;
    i.state.error = null;
  }, actionErrorMs);
};

// A success clears a prior action error; a connection error is a condition it does not resolve.
const clearAction = (i: StoreInternals): void => {
  if (i.state.error?.kind === 'action') clear(i);
};

export const storeErrors: {
  report: typeof report;
  clear: typeof clear;
  clearAction: typeof clearAction;
  actionErrorMs: number;
} = { report, clear, clearAction, actionErrorMs };
