import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';

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

export const useMessageReply = (events: () => readonly FluxEvent[]): MessageReply => {
  const reply = ref<ReplyTarget | null>(null);
  const messages: ComputedRef<Map<number, ReplyTarget>> = computed(() => {
    const map = new Map<number, ReplyTarget>();
    for (const event of events()) {
      const found = target(event);
      if (found !== null) map.set(found.seq, found);
    }
    return map;
  });
  return {
    reply,
    quoteOf: (event) => {
      const answered = fluxEvent.isKnown(event) && event.type === 'msg.user';
      const replyTo = answered ? event.payload.replyTo : null;
      return replyTo === undefined || replyTo === null ? null : messages.value.get(replyTo)?.text;
    },
    startReply: (seq) => {
      reply.value = messages.value.get(seq) ?? null;
    },
    cancelReply: () => {
      reply.value = null;
    },
  };
};
