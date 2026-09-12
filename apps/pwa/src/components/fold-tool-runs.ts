import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

// The timeline's rows with each run of past tool calls folded behind one line. An agent working
// through a task logs dozens of tool rows between one message and the next, and once its next
// message has landed they are history: a screen of `Bash ok, 63 lines` that the operator scrolls
// past. Each such run becomes a `fold`, a disclosure the operator can open when they want the
// rows, counting its calls and how many failed. The run still being written, the one nothing
// has followed yet, stays flat so live activity reads as it always did, and folds when the
// agent's next message or note arrives. Any row that is not a tool call ends a run: a task chip
// between an Agent call's start and end stays where it is, not buried in the fold. A run too
// short to be worth a line (one call, start and end) stays flat too. Pure over the window of
// rows the parent already cut, so a fold begins at the window's edge when the trim lands
// inside a run, and a remnant of one or two rows at the edge folds only once Show earlier
// brings the rest back. `keepFrom` is the caller's hold: rows from that seq on are what the
// operator is reading, scrolled up as new rows land, and no run reaching them folds until the
// caller lifts it, so nothing on screen vanishes under them (SessionTimeline.vue).

export interface TimelineFold {
  kind: 'fold';
  // The last row's seq, the key: it stays put while Show earlier prepends rows and a trim cuts
  // the top of the window, so an open fold stays open across both.
  seq: number;
  rows: FluxEvent[];
  text: string;
  tone: 'error' | null;
}

export type TimelineEntry = TimelineFold | { kind: 'row'; seq: number; row: FluxEvent };

const minFold = 3;

const isToolRow = (event: FluxEvent): boolean =>
  event.type === 'tool.start' || event.type === 'tool.end';

const failed = (event: FluxEvent): boolean =>
  fluxEvent.isKnown(event) && event.type === 'tool.end' && !event.payload.ok;

// Calls are counted by their starts, or by their ends when the window's top edge cut every
// start away: a run is never longer than the calls it holds.
const fold = (rows: FluxEvent[]): TimelineFold => {
  const starts = rows.filter((row) => row.type === 'tool.start').length;
  const calls = Math.max(starts, rows.length - starts);
  const failures = rows.filter((row) => failed(row)).length;
  const count = `${calls} tool call${calls === 1 ? '' : 's'}`;
  const text = failures === 0 ? count : `${count}, ${failures} failed`;
  return {
    kind: 'fold',
    seq: rows.at(-1)?.seq ?? 0,
    rows,
    text,
    tone: failures === 0 ? null : 'error',
  };
};

const worthFolding = (run: FluxEvent[], keepFrom: number | null): boolean =>
  run.length >= minFold && (keepFrom === null || (run.at(-1)?.seq ?? 0) < keepFrom);

export const foldToolRuns = (
  rows: readonly FluxEvent[],
  keepFrom: number | null = null,
): TimelineEntry[] => {
  const entries: TimelineEntry[] = [];
  let run: FluxEvent[] = [];
  // A followed run folds; the trailing one, a short one and a held one lie flat.
  const settle = (position: 'followed' | 'trailing'): void => {
    if (position === 'followed' && worthFolding(run, keepFrom)) entries.push(fold(run));
    else for (const row of run) entries.push({ kind: 'row', seq: row.seq, row });
    run = [];
  };
  for (const row of rows) {
    if (isToolRow(row)) {
      run.push(row);
      continue;
    }
    settle('followed');
    entries.push({ kind: 'row', seq: row.seq, row });
  }
  settle('trailing');
  return entries;
};
