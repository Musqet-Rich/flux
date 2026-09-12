import { mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';

import { icons } from '../icons/icons.ts';
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
    'table with inline markup and alignment as a fixed style',
    '| **a** | b |\n|--:|---|\n| `c` | d |',
    [
      ['div.table > table > thead > tr > th[style="text-align: right;"] > strong', 'a'],
      ['thead th:last-child:not([style])', 'b'],
      ['tbody > tr > td[style="text-align: right;"] > code', 'c'],
      ['tbody td:last-child', 'd'],
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

// Whatever the agent writes, the tree holds only these tags, and the only attributes are the
// renderer's own classes and a link's `http(s)` URL: the CSP has no `unsafe-inline`, so an
// unexpected tag or attribute here is the one thing that could ever run agent text.
const allowedTags = new Set([
  'DIV',
  'P',
  'UL',
  'OL',
  'LI',
  'PRE',
  'CODE',
  'STRONG',
  'EM',
  'A',
  'BLOCKQUOTE',
  'BR',
  // The code block's Copy button (CodeBlock.vue) and the Icon inside it. `tagName` keeps an
  // SVG element's case, so these two are matched exactly: an `a` in the SVG namespace, say,
  // would not pass as the HTML link.
  'BUTTON',
  'svg',
  'path',
  'SPAN',
]);
const classAllowed: Record<string, RegExp> = {
  DIV: /^(markdown|code-block)$/u,
  P: /^heading h[123]$/u,
  PRE: /^open$/u,
  CODE: /^language-[\w+#.-]+$/u,
  // The resting face: no probe taps the button.
  BUTTON: /^icon-only copy$/u,
  svg: /^icon$/u,
  SPAN: /^visually-hidden$/u,
};
// The Copy button's own fixed attributes: the icon's path is one of the app's own, and the
// button's name carries the fence's language, which `fenceRe` limits to these characters.
const iconPaths = new Set(Object.values(icons));
const fixedAllowed: Record<string, Record<string, (value: string) => boolean>> = {
  BUTTON: {
    type: (v) => v === 'button',
    'aria-label': (v) => /^Copy (?:[\w+#.-]+ )?code$/u.test(v),
    title: (v) => v === 'Copy',
  },
  svg: {
    viewBox: (v) => v === '0 0 256 256',
    'data-icon': (v) => v === 'copy',
    'aria-hidden': (v) => v === 'true',
    focusable: (v) => v === 'false',
  },
  path: { d: (v) => iconPaths.has(v) },
  SPAN: { role: (v) => v === 'status' },
};
const attributesAllowed = (el: Element): boolean =>
  [...el.attributes].every(({ name, value }) => {
    if (name === 'class') return classAllowed[el.tagName]?.test(value) === true;
    // Scoped-style markers: a fixed hash, never text.
    if (/^data-v-[0-9a-f]+$/u.test(name)) return value === '';
    if (el.tagName !== 'A') return fixedAllowed[el.tagName]?.[name]?.(value) === true;
    if (name === 'href') return /^https?:\/\//u.test(value);
    return (
      (name === 'rel' && value === 'noopener noreferrer') ||
      (name === 'target' && value === '_blank')
    );
  });

const probes = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[x](javascript:alert(1))',
  '[x](JAVASCRIPT:alert(1))',
  '[x](  javascript:alert(1))',
  '[x](java\nscript:alert(1))',
  '[x](data:text/html,<script>alert(1)</script>)',
  '[x](vbscript:msgbox)',
  '[x](//evil/)',
  '[x](https://a.b" onclick="alert(1))',
  '[x](https://a.b/?q=1) onclick=alert(1)',
  '![img](https://x/y.png)',
  '<a href="https://x/">x</a> inline',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;',
  '**[**x**](https://u/)**',
  '```html\n</code></pre><script>alert(1)</script>\n```',
  '```\n</code></pre><script>alert(1)</script>',
  '[x](https://x/a(b)c)',
  '[x](https://x/\u202E\u200B\u0000)',
  '\u202E<script>\u200B</script>',
  '# <svg onload=alert(1)>',
  '> <iframe src=x>',
  '- <b onmouseover=alert(1)>x</b>',
  '`</code><script>alert(1)</script>`',
  '[<script>x</script>](https://x/)',
  '<script>'.repeat(20 * 1024),
  '[x](https://x/)'.repeat(15 * 1024),
];

test.each(probes)('%s never becomes markup', (input) => {
  const wrapper = render(input);
  for (const { element } of wrapper.findAll('*')) {
    expect(allowedTags.has(element.tagName)).toBe(true);
    expect(attributesAllowed(element)).toBe(true);
  }
  expect(wrapper.text().length).toBeGreaterThan(0);
});

// Each block's Copy is wired to its own body, not the message's first.
// The clipboard the test installs is taken away again, and its reset timer never fires.
const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  vi.useRealTimers();
  if (original === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
  else Object.defineProperty(navigator, 'clipboard', original);
});

test('two fences copy their own bodies', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const wrapper = render('```\none\n```\n\n```sh\ntwo\n```');
  const buttons = wrapper.findAll('.copy');
  expect(buttons.map((b) => b.attributes('aria-label'))).toEqual(['Copy code', 'Copy sh code']);
  await buttons[1]?.trigger('click');
  expect(writeText).toHaveBeenCalledWith('two');
  wrapper.unmount();
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
