import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { Reply } from './render-reply.ts';

// The message an `agent.send.replyTo` names (protocol.md § 5, Rules: `msg.user.replyTo`), or
// null when the event is not one the operator can answer: a non-message row, or a subagent's
// row (`parent` set), whose `msg.user` is the agent's own prompt to its subagent, which the
// operator neither wrote nor can address from main's composer.
export const quotedMessage = (event: FluxEvent | undefined): Reply | null => {
  if (event === undefined || event.parent !== undefined || !fluxEvent.isKnown(event)) return null;
  const { seq } = event;
  if (event.type === 'msg.user') return { seq, from: 'user', text: event.payload.text };
  if (event.type === 'msg.assistant') return { seq, from: 'assistant', text: event.payload.text };
  return null;
};
