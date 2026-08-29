import type { VNode, VNodeChild } from 'vue';
import { h } from 'vue';

import type { InlineNode } from './inline-markdown.ts';
import { inlineMarkdown } from './inline-markdown.ts';
import type { MarkdownBlock, MarkdownCode, MarkdownListItem } from './tokenise-markdown.ts';
import { tokeniseMarkdown } from './tokenise-markdown.ts';

// Assistant messages and the streaming bubble go through this: a small, deliberately partial
// Markdown renderer (engineering.md § Dependencies rejects a package for what ~100 lines cover)
// that builds VNodes with `h()` from the token tree. There is no `v-html` and no HTML string
// anywhere, so text from the agent can only ever become text nodes. Links open in a new tab
// with `noopener noreferrer`; only `http:`/`https:` URLs survive the inline pass.

const inlineNode = (node: InlineNode): VNodeChild => {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'code':
      return h('code', node.text);
    case 'strong':
    case 'em':
      return h(
        node.kind,
        node.children.map((child) => inlineNode(child)),
      );
    case 'link':
      return h(
        'a',
        { href: node.href, rel: 'noopener noreferrer', target: '_blank' },
        node.children.map((child) => inlineNode(child)),
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

const code = (node: MarkdownCode): VNode =>
  h('pre', { class: node.closed ? null : 'open' }, [
    h('code', { class: node.lang === '' ? null : `language-${node.lang}` }, node.text),
  ]);

const block = (node: MarkdownBlock): VNode => {
  if (node.kind === 'paragraph') return h('p', lines(node.lines));
  if (node.kind === 'heading') {
    return h('p', { class: `heading h${node.level}` }, [h('strong', inlines(node.text))]);
  }
  if (node.kind === 'code') return code(node);
  if (node.kind === 'quote') return h('blockquote', lines(node.lines));
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
