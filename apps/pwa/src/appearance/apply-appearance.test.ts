import { nextTick } from 'vue';
import { afterEach, expect, test } from 'vitest';

import { fakeAppearance } from '../../test/fake-appearance.ts';
import { applyAppearance } from './apply-appearance.ts';

// The document is shared by every test in the file; each leaves it bare, whatever it asserted.
afterEach(() => {
  delete document.documentElement.dataset['scheme'];
  document.documentElement.style.fontSize = '';
  for (const el of document.head.querySelectorAll('meta, style')) el.remove();
});

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
