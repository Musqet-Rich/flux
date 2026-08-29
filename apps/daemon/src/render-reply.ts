// Renders the message a user message replies to (protocol.md § 5, Rules: `msg.user.replyTo`)
// into the text the agent sees: a `>` block of the quoted message, capped, then the message.

// Both caps are prompt hygiene: the quote is a pointer to a message the agent already has in
// its context, not a re-send of it, so a long reply (a 200 kB report) or a long single line
// must not swamp the operator's own words. The line cap bounds the quote's height, the
// character cap its size.
const quoteLineLimit = 20;
const quoteCharLimit = 4000;

export interface Reply {
  seq: number;
  from: 'user' | 'assistant';
  text: string;
}

const clip = (text: string): { lines: string[]; cut: boolean } => {
  const short = text.length > quoteCharLimit;
  const lines = (short ? text.slice(0, quoteCharLimit) : text).split('\n');
  const long = lines.length > quoteLineLimit;
  return { lines: long ? lines.slice(0, quoteLineLimit) : lines, cut: short || long };
};

export const renderReply = (text: string, reply: Reply | null): string => {
  if (reply === null) return text;
  const { lines, cut } = clip(reply.text);
  const kept = cut ? [...lines, '…'] : lines;
  const whose = reply.from === 'assistant' ? 'your' : 'my';
  const quoted = kept.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
  return `In reply to ${whose} earlier message:\n\n${quoted}\n\n${text}`;
};
