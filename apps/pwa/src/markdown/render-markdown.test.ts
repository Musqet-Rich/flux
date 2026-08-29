import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { renderMarkdown } from './render-markdown.ts';

const render = (text: string) => mount({ render: () => renderMarkdown(text) });

// Selector → text for each element expected, in document order, plus the html for injection.
const cases: [string, string, [string, string][]][] = [
  [
    'paragraph with a line break',
    'a\nb',
    [
      ['p', 'ab'],
      ['p br', ''],
    ],
  ],
  [
    'heading is a bold line',
    '## Title *x*',
    [
      ['p.heading.h2 > strong', 'Title x'],
      ['strong em', 'x'],
    ],
  ],
  ['fenced code', '```ts\nlet a\n```', [['pre > code.language-ts', 'let a']]],
  ['unclosed fence is an open block', '```\nhalf', [['pre.open > code', 'half']]],
  ['fence without language has no class', '```\nx\n```', [['pre > code:not([class])', 'x']]],
  [
    'nested lists',
    '- a\n  1. b\n- c',
    [
      ['ul > li:first-child', 'ab'],
      ['ul > li > ol > li', 'b'],
      ['ul > li:last-child', 'c'],
    ],
  ],
  [
    'blockquote',
    '> q\n> r',
    [
      ['blockquote', 'qr'],
      ['blockquote br', ''],
    ],
  ],
  [
    'inline',
    'a `b` **c** *d*',
    [
      ['p code', 'b'],
      ['p strong', 'c'],
      ['p em', 'd'],
    ],
  ],
  [
    'link',
    '[t](https://x.y/)',
    [['p a[href="https://x.y/"][target="_blank"][rel="noopener noreferrer"]', 't']],
  ],
];

test.each(cases)('%s', (_name, input, expected) => {
  const wrapper = render(input);
  expect(wrapper.find('div.markdown').exists()).toBe(true);
  for (const [selector, text] of expected) {
    expect(wrapper.get(selector).text()).toBe(text);
  }
});

const injections: [string, string, string][] = [
  ['script tag', '<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['img onerror', '<img src=x onerror="alert(1)">', '&lt;img src=x onerror="alert(1)"&gt;'],
  ['html inside code', '```\n<b>x</b>\n```', '&lt;b&gt;x&lt;/b&gt;'],
  ['html inside a link label', '[<i>x</i>](https://x/)', '&lt;i&gt;x&lt;/i&gt;'],
  ['javascript link stays text', '[x](javascript:alert(1))', '[x](javascript:alert(1))'],
  ['bracket trick', '[x](https://ok/)](javascript:alert(1))', '](javascript:alert(1))'],
];

test.each(injections)('%s comes out inert', (_name, input, escaped) => {
  const wrapper = render(input);
  const html = wrapper.html();
  expect(html).toContain(escaped);
  expect(wrapper.find('script').exists()).toBe(false);
  expect(wrapper.find('img').exists()).toBe(false);
  expect(wrapper.find('i').exists()).toBe(false);
  for (const a of wrapper.findAll('a')) expect(a.attributes('href')?.startsWith('http')).toBe(true);
});

// A long reply must render synchronously (mount is synchronous, so a stall here is a hang).
test('a 20 KB message renders in one pass', () => {
  const chunk =
    '# Head\n\nSome **bold** and `code` with [a link](https://x/) here.\n\n- one\n  - two\n\n```js\nlet x = 1;\n```\n\n';
  const text = chunk.repeat(Math.ceil((20 * 1024) / chunk.length));
  expect(text.length).toBeGreaterThan(20 * 1024);
  const wrapper = render(text);
  expect(wrapper.findAll('pre').length).toBeGreaterThan(100);
  expect(wrapper.findAll('a').length).toBe(wrapper.findAll('pre').length);
});

test('a message with nothing but text is one paragraph', () => {
  expect(render('hi there').html()).toBe('<div class="markdown">\n  <p>hi there</p>\n</div>');
});
