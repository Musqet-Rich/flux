import type { EventPayloads, FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

// The session's pull request, if one has been published: the latest `pr.published` in the log,
// whether the agent opened it with `gh` or the operator did from the changes screen. The box
// logs both, so this is the one place the PWA learns of a PR (protocol.md § 5).

export const sessionPr = (events: readonly FluxEvent[]): EventPayloads['pr.published'] | null => {
  const last = events.findLast((e) => e.type === 'pr.published');
  return last !== undefined && fluxEvent.isKnown(last) && last.type === 'pr.published'
    ? last.payload
    : null;
};
