import { nextTick } from 'vue';
import { afterEach, expect, test } from 'vitest';

import { fakeAppearance } from '../../test/fake-appearance.ts';
import { applyAppearance } from './apply-appearance.ts';
import { presets } from './presets.ts';

// The document is shared by every test in the file; each leaves it bare, whatever it asserted.
afterEach(() => {
  delete document.documentElement.dataset['scheme'];
  document.documentElement.style.cssText = '';
  for (const el of document.head.querySelectorAll('meta, style')) el.remove();
});

const { nord } = presets;
const property = (name: string): string => document.documentElement.style.getPropertyValue(name);

test('the scheme and the size go on the root at once and follow each change', async () => {
  const a = fakeAppearance();
  const stop = applyAppearance(document, a);
  const root = document.documentElement;
  expect(root.dataset['scheme']).toBe('dark');
  expect(root.style.fontSize).toBe('15px');
  a.setMode('light');
  a.setFontSize(18);
  await nextTick();
  expect(root.dataset['scheme']).toBe('light');
  expect(root.style.fontSize).toBe('18px');
  stop();
  a.setMode('dark');
  await nextTick();
  expect(root.dataset['scheme']).toBe('light');
});

const metaOf = (content: string): HTMLMetaElement => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = content;
  document.head.append(meta);
  return meta;
};

test('the theme goes on the root as light-dark pairs, the default too, and follows a change', async () => {
  const a = fakeAppearance();
  const stop = applyAppearance(document, a);
  expect(property('--bg')).toBe('light-dark(#f5f6f8, #0f1115)');
  expect(property('--ansi-15')).toBe('light-dark(#1a1d24, #ffffff)');
  a.setTheme(nord);
  await nextTick();
  expect(property('--bg')).toBe('light-dark(#eceff4, #2e3440)');
  expect(property('--accent-fg')).toBe('light-dark(#eceff4, #2e3440)');
  expect(property('--ansi-15')).toBe('light-dark(#2e3440, #eceff4)');
  a.setTheme({ name: 'x', dark: { accent: '#ff00ff' } });
  await nextTick();
  // Nothing of the previous theme is left where the new one said nothing.
  expect(property('--bg')).toBe('light-dark(#f5f6f8, #0f1115)');
  expect(property('--accent')).toBe('light-dark(#2a63c4, #ff00ff)');
  a.setTheme(null);
  await nextTick();
  expect(property('--accent')).toBe('light-dark(#2a63c4, #4f8cff)');
  stop();
});

test('the font stacks go on the root with the colours, the platform stack where no family is named', async () => {
  const a = fakeAppearance();
  const stop = applyAppearance(document, a);
  expect(property('--font-code')).toBe('ui-monospace, SFMono-Regular, Menlo, monospace');
  a.setTheme({ name: 'x', fonts: { code: 'JetBrains Mono' } });
  await nextTick();
  expect(property('--font-code')).toBe(
    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  );
  expect(property('--font-text')).toBe("system-ui, -apple-system, 'Segoe UI', sans-serif");
  a.setTheme(null);
  await nextTick();
  expect(property('--font-code')).toBe('ui-monospace, SFMono-Regular, Menlo, monospace');
  stop();
});

test('the theme-color metas keep their markup values while the page has no background', () => {
  const meta = metaOf('#0f1115');
  const stop = applyAppearance(document, fakeAppearance());
  expect(meta.content).toBe('#0f1115');
  stop();
});

test('every theme-color meta takes the page background the scheme came to', async () => {
  const style = document.createElement('style');
  style.textContent =
    'body { background: rgb(1, 2, 3); } :root[data-scheme="light"] body { background: rgb(4, 5, 6); }';
  document.head.append(style);
  const metas = [metaOf('#0f1115'), metaOf('#f5f6f8')];
  const a = fakeAppearance();
  const stop = applyAppearance(document, a);
  expect(metas.map((m) => m.content)).toEqual(['rgb(1, 2, 3)', 'rgb(1, 2, 3)']);
  a.setMode('light');
  await nextTick();
  expect(metas.map((m) => m.content)).toEqual(['rgb(4, 5, 6)', 'rgb(4, 5, 6)']);
  stop();
});
