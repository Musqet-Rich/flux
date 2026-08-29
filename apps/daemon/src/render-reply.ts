// Renders the message a user message replies to (protocol.md § 5, Rules: `msg.user.replyTo`)
// into the text the agent sees: a `>` block of the quoted message, capped, then the message.

const quoteLineLimit = 20;

export interface Reply {
  seq: number;
  from: 'user' | 'assistant';
  text: string;
}

export const renderReply = (text: string, reply: Reply | null): string => {
  if (reply === null) return text;
  const lines = reply.text.split('\n');
  const kept = lines.slice(0, quoteLineLimit);
  if (lines.length > quoteLineLimit) kept.push('…');
  const whose = reply.from === 'assistant' ? 'your' : 'my';
  const quoted = kept.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
  return `In reply to ${whose} earlier message:\n\n${quoted}\n\n${text}`;
};
