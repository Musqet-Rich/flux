import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import type { Ref } from 'vue';
import { ref } from 'vue';

import type { LogFold } from '../store/log-fold.ts';
import { useLogFold } from './useLogFold.ts';

// Replying to a message (protocol.md § 5, `msg.user.replyTo`): the message the next send
// answers, picked from a bubble's menu and cleared on send or by hand, and the lookup a reply
// row uses to show the message it answered. Both read the log's messages by seq.

export interface ReplyTarget {
  seq: number;
  from: 'user' | 'assistant';
  text: string;
}

export interface MessageReply {
  reply: Ref<ReplyTarget | null>;
  // The text of the message a `msg.user` row answers; null for any other row, undefined when
  // the answered message is not in the log.
  quoteOf: (event: FluxEvent) => string | null | undefined;
  startReply: (seq: number) => void;
  cancelReply: () => void;
}

const target = (event: FluxEvent): ReplyTarget | null => {
  if (!fluxEvent.isKnown(event)) return null;
  const { seq } = event;
  if (event.type === 'msg.user') return { seq, from: 'user', text: event.payload.text };
  if (event.type === 'msg.assistant') return { seq, from: 'assistant', text: event.payload.text };
  return null;
};

// The log's messages by seq, kept up as the log grows (store/log-fold).
const messagesFold: LogFold<{ bySeq: Map<number, ReplyTarget> }> = {
  init: () => ({ bySeq: new Map() }),
  step: (acc, event) => {
    const found = target(event);
    if (found === null) return acc;
    acc.bySeq.set(found.seq, found);
    return { bySeq: acc.bySeq };
  },
};

export const useMessageReply = (events: () => readonly FluxEvent[]): MessageReply => {
  const reply = ref<ReplyTarget | null>(null);
  const messages = useLogFold(events, messagesFold);
  return {
    reply,
    quoteOf: (event) => {
      const answered = fluxEvent.isKnown(event) && event.type === 'msg.user';
      const replyTo = answered ? event.payload.replyTo : null;
      return replyTo === undefined || replyTo === null
        ? null
        : messages.value.bySeq.get(replyTo)?.text;
    },
    startReply: (seq) => {
      reply.value = messages.value.bySeq.get(seq) ?? null;
    },
    cancelReply: () => {
      reply.value = null;
    },
  };
};
