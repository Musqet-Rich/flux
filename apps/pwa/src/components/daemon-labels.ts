import type { DaemonChoice } from '../store/store-state.ts';

// What the picker and Settings call each paired daemon (ADR 0037): its name from `hello`, or
// "Unnamed daemon" before the first one. Two daemons on one machine are likely to share a name
// (the default is the host's), so a name that is not unique gets the start of its pairing id.

const fallback = 'Unnamed daemon';

export const daemonLabels = (daemons: readonly DaemonChoice[]): Map<string, string> => {
  const counts = new Map<string, number>();
  for (const d of daemons) {
    const name = d.name ?? fallback;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Map(
    daemons.map((d) => {
      const name = d.name ?? fallback;
      const unique = counts.get(name) === 1;
      return [d.id, unique ? name : `${name} (${d.id.slice(0, 6)})`];
    }),
  );
};
