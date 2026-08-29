import type { ErrorKind, StoreError, StoreInternals } from './store-state.ts';

// `state.error` for the status bar. An action's failure (a send, a git action, a settings save)
// is news for a moment and goes on its own after `actionErrorMs`, or sooner when the next
// action succeeds or the operator dismisses it. A connection failure (pairing refused, the box
// forgot this device, hello failed) describes a standing condition and stays until it clears
// or is dismissed. An action error shown while a connection error stands only covers it: when
// the action error goes, the connection error is back, because its condition has not changed.
// Dismissal clears both. The timer is injected so tests fire it rather than wait.

const actionErrorMs = 8000;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => {
    clearTimeout(timer);
  };
};

const cancelTimer = (i: StoreInternals): void => {
  i.errorTimer?.();
  i.errorTimer = null;
};

// Everything goes: the box is back, pairing starts afresh, the operator tapped ×, or the store
// stopped.
const clear = (i: StoreInternals): void => {
  cancelTimer(i);
  i.connectionError = null;
  i.state.error = null;
};

// A success clears a prior action error; a connection error is a condition it does not resolve.
const clearAction = (i: StoreInternals): void => {
  if (i.state.error?.kind !== 'action') return;
  cancelTimer(i);
  i.state.error = i.connectionError;
};

// Replaces the shown error; a fresh action error restarts the clock so it gets its full time.
const report = (i: StoreInternals, error: unknown, kind: ErrorKind = 'action'): void => {
  cancelTimer(i);
  const shown: StoreError = {
    message: error instanceof Error ? error.message : String(error),
    kind,
  };
  i.state.error = shown;
  if (kind === 'connection') {
    i.connectionError = shown;
    return;
  }
  const schedule = i.options.schedule ?? defaultSchedule;
  i.errorTimer = schedule(() => {
    clearAction(i);
  }, actionErrorMs);
};

export const storeErrors: {
  report: typeof report;
  clear: typeof clear;
  clearAction: typeof clearAction;
  actionErrorMs: number;
} = { report, clear, clearAction, actionErrorMs };
