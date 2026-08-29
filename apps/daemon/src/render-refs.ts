import type { CodeRef } from '@flux/protocol';

// Renders the code references attached to a user message into the text the agent sees
// (protocol.md § 5, Rules: a fenced block with path and line range plus the referenced lines).

const wholeFileLimit = 200;

const fence = (ref: CodeRef, lines: string[]): string => {
  const range = ref.range === undefined ? '' : `:${ref.range.startLine}-${ref.range.endLine}`;
  const body = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  return `\`\`\`${ref.path}${range}\n${body}\`\`\``;
};

const slice = (content: string, ref: CodeRef): string[] => {
  const all = content.split('\n');
  if (ref.range === undefined) return all.slice(0, wholeFileLimit);
  return all.slice(ref.range.startLine - 1, ref.range.endLine);
};

// `contents[i]` is the file behind `refs[i]`, or null when it could not be read.
export const renderRefs = (text: string, refs: CodeRef[], contents: (string | null)[]): string => {
  const blocks = refs.map((ref, i) => {
    const content = contents[i] ?? null;
    return content === null ? fence(ref, ['(unavailable)']) : fence(ref, slice(content, ref));
  });
  return blocks.length === 0 ? text : `${text}\n\n${blocks.join('\n\n')}`;
};
