// Inline pass of the timeline's Markdown renderer: one line of text into runs of plain text,
// `code`, **strong**, *em* and [links](https://…). Every run is data; the renderer turns text
// runs into DOM text nodes, so the agent's `<` is always a character, never a tag. Links are
// kept only when the URL parses with an `http:` or `https:` scheme; anything else, including
// `javascript:`, stays literal text so the operator sees exactly what the agent wrote.

export interface InlineText {
  kind: 'text';
  text: string;
}

export interface InlineCode {
  kind: 'code';
  text: string;
}

export interface InlineSpan {
  kind: 'strong' | 'em';
  children: InlineNode[];
}

export interface InlineLink {
  kind: 'link';
  href: string;
  children: InlineNode[];
}

export type InlineNode = InlineText | InlineCode | InlineSpan | InlineLink;

interface Hit {
  node: InlineNode;
  end: number;
}

const safeHref = (href: string): string | null => {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

const codeAt = (text: string, at: number): Hit | null => {
  const end = text.indexOf('`', at + 1);
  if (end <= at + 1) return null;
  return { node: { kind: 'code', text: text.slice(at + 1, end) }, end: end + 1 };
};

const emAt = (text: string, at: number): Hit | null => {
  const close = text.indexOf('*', at + 1);
  if (close <= at + 1 || /\s/u.test(text.charAt(at + 1))) return null;
  const children = inlineMarkdown(text.slice(at + 1, close));
  return { node: { kind: 'em', children }, end: close + 1 };
};

// `**` first; a lone `*` opens emphasis only when the content starts with a non-space (so
// `2 * 3 * 4` stays arithmetic) and closes before the end of the line.
const strongAt = (text: string, at: number): Hit | null => {
  if (!text.startsWith('**', at)) return emAt(text, at);
  const close = text.indexOf('**', at + 2);
  if (close <= at + 2 || /\s/u.test(text.charAt(at + 2))) return emAt(text, at);
  const children = inlineMarkdown(text.slice(at + 2, close));
  return { node: { kind: 'strong', children }, end: close + 2 };
};

const linkAt = (text: string, at: number): Hit | null => {
  const close = text.indexOf(']', at + 1);
  if (close < 0 || text.charAt(close + 1) !== '(') return null;
  const end = text.indexOf(')', close + 2);
  if (end < 0) return null;
  const href = safeHref(text.slice(close + 2, end).trim());
  if (href === null) return null;
  const children = inlineMarkdown(text.slice(at + 1, close));
  return { node: { kind: 'link', href, children }, end: end + 1 };
};

const hitAt = (text: string, at: number): Hit | null => {
  switch (text.charAt(at)) {
    case '`':
      return codeAt(text, at);
    case '*':
      return strongAt(text, at);
    case '[':
      return linkAt(text, at);
    default:
      return null;
  }
};

export const inlineMarkdown = (text: string): InlineNode[] => {
  const nodes: InlineNode[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const hit = hitAt(text, i);
    if (hit === null) {
      plain += text.charAt(i);
      i += 1;
      continue;
    }
    if (plain !== '') nodes.push({ kind: 'text', text: plain });
    plain = '';
    nodes.push(hit.node);
    i = hit.end;
  }
  if (plain !== '') nodes.push({ kind: 'text', text: plain });
  return nodes;
};
