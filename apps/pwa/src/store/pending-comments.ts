import type { CodeRef, FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

// Comments the operator has left but not yet sent (architecture.md § PWA `pendingComments`):
// every `comment.added` that no later `comment.sent` names and no `comment.removed` withdrew.
// A `session.cleared` marker is not a boundary here: the comments are about the code, not the
// conversation, and go with the next message to the fresh agent.

export interface PendingComment {
  commentId: string;
  ref: CodeRef;
  text: string;
}

export const pendingComments = (events: readonly FluxEvent[]): PendingComment[] => {
  const added = new Map<string, PendingComment>();
  for (const event of events) {
    if (!fluxEvent.isKnown(event)) continue;
    if (event.type === 'comment.added') added.set(event.payload.commentId, event.payload);
    else if (event.type === 'comment.removed') added.delete(event.payload.commentId);
    else if (event.type === 'comment.sent') {
      for (const id of event.payload.commentIds) added.delete(id);
    }
  }
  return [...added.values()];
};
