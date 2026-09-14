import type { CodeRef } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { LogFold } from './log-fold.ts';

// Comments the operator has left but not yet sent (architecture.md § PWA `pendingComments`):
// every `comment.added` that no later `comment.sent` names and no `comment.removed` withdrew.
// A `session.cleared` marker is not a boundary here: the comments are about the code, not the
// conversation, and go with the next message to the fresh agent.

export interface PendingComment {
  commentId: string;
  ref: CodeRef;
  text: string;
}

// In the order they were added, by id. A comment event returns a fresh wrapper so readers see
// the change; any other event leaves the value alone.
export const pendingComments: LogFold<{ added: Map<string, PendingComment> }> = {
  init: () => ({ added: new Map() }),
  step: (acc, event) => {
    if (!fluxEvent.isKnown(event)) return acc;
    const { added } = acc;
    if (event.type === 'comment.added') added.set(event.payload.commentId, event.payload);
    else if (event.type === 'comment.removed') {
      if (!added.delete(event.payload.commentId)) return acc;
    } else if (event.type === 'comment.sent') {
      const sent = event.payload.commentIds.filter((id) => added.delete(id));
      if (sent.length === 0) return acc;
    } else return acc;
    return { added };
  },
};
