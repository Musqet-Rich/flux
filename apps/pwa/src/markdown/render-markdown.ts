import type { VNode, VNodeChild } from 'vue';
import { h } from 'vue';

import CodeBlock from '../components/CodeBlock.vue';
import InlineCode from '../components/InlineCode.vue';
import type { InlineNode } from './inline-markdown.ts';
import { inlineMarkdown } from './inline-markdown.ts';
import type {
  MarkdownBlock,
  MarkdownCode,
  MarkdownListItem,
  MarkdownTable,
} from './tokenise-markdown.ts';
import { tokeniseMarkdown } from './tokenise-markdown.ts';

// Messages from both sides and the streaming bubble go through this: a small, deliberately partial
// Markdown renderer (engineering.md § Dependencies rejects a package for what ~100 lines cover)
// that builds VNodes with `h()` from the token tree. There is no `v-html` and no HTML string
// anywhere, so text from the agent can only ever become text nodes. Links open in a new tab
// with `noopener noreferrer`; only `http:`/`https:` URLs survive the inline pass.

// Inline code copies on a tap (InlineCode.vue), except inside a link, where the tap is the
// link's: a span that both copied and opened a tab would do neither reliably.
const inlineNode = (node: InlineNode, inLink = false): VNodeChild => {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'code':
      return inLink ? h('code', node.text) : h(InlineCode, { text: node.text });
    case 'strong':
    case 'em':
      return h(
        node.kind,
        node.children.map((child) => inlineNode(child, inLink)),
      );
    case 'link':
      return h(
        'a',
        { href: node.href, rel: 'noopener noreferrer', target: '_blank' },
        node.children.map((child) => inlineNode(child, true)),
      );
  }
};

const inlines = (text: string): VNodeChild[] =>
  inlineMarkdown(text).map((node) => inlineNode(node));

// Line breaks inside a paragraph are kept: agents wrap by hand and the phone is narrow anyway.
const lines = (texts: string[]): VNodeChild[] =>
  texts.flatMap((text, i) => (i === 0 ? inlines(text) : [h('br'), ...inlines(text)]));

const listItem = (item: MarkdownListItem): VNode =>
  h('li', item.nested === null ? lines(item.lines) : [...lines(item.lines), block(item.nested)]);

// A block that is a component rather than a bare element: the Copy button keeps state.
const code = (node: MarkdownCode): VNode =>
  h(CodeBlock, { text: node.text, lang: node.lang, closed: node.closed });

// Cell alignment from the delimiter row becomes a `style`, the only attribute the renderer sets
// from the text, and it is one of three fixed values.
const table = (node: MarkdownTable): VNode => {
  const cell = (tag: 'th' | 'td', text: string, column: number): VNode => {
    const align = node.align[column] ?? null;
    return h(tag, align === null ? null : { style: { textAlign: align } }, inlines(text));
  };
  const row = (tag: 'th' | 'td', texts: string[]): VNode =>
    h(
      'tr',
      texts.map((text, column) => cell(tag, text, column)),
    );
  return h('div', { class: 'table' }, [
    h('table', [
      h('thead', [row('th', node.header)]),
      h(
        'tbody',
        node.rows.map((texts) => row('td', texts)),
      ),
    ]),
  ]);
};

const block = (node: MarkdownBlock): VNode => {
  if (node.kind === 'paragraph') return h('p', lines(node.lines));
  if (node.kind === 'heading') {
    return h('p', { class: `heading h${node.level}` }, [h('strong', inlines(node.text))]);
  }
  if (node.kind === 'code') return code(node);
  if (node.kind === 'quote') return h('blockquote', lines(node.lines));
  if (node.kind === 'table') return table(node);
  return h(
    node.ordered ? 'ol' : 'ul',
    node.items.map((item) => listItem(item)),
  );
};

export const renderMarkdown = (text: string): VNode =>
  h(
    'div',
    { class: 'markdown' },
    tokeniseMarkdown(text).map((node) => block(node)),
  );
