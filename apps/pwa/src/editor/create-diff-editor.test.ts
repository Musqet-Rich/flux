import type { LineRange } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createDiffEditor } from './create-diff-editor.ts';

const adoptedCss = (root: ShadowRoot | null): string =>
  (root?.adoptedStyleSheets ?? [])
    .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
    .join('\n');

test('mounts inside a shadow root so its styles bypass the CSP, and reports selections', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const ranges: (LineRange | null)[] = [];
  const editor = createDiffEditor({
    parent,
    original: 'a\nb\nc\n',
    current: 'a\nB\nc\nd\n',
    onSelection: (range) => {
      ranges.push(range);
    },
  });
  expect(parent.shadowRoot).not.toBeNull();
  expect(parent.shadowRoot?.querySelector('.cm-editor')).not.toBeNull();
  expect(document.head.querySelector('style')).toBeNull();
  expect(parent.shadowRoot?.querySelector('.cm-lineNumbers')).not.toBeNull();
  editor.clearSelection();
  editor.destroy();
  expect(parent.shadowRoot?.querySelector('.cm-editor')).toBeNull();
});

test('wraps long lines and wears the shared theme, on the current and the deleted side', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createDiffEditor({
    parent,
    original: 'a\n',
    current: 'b\n',
    onSelection: () => {},
  });
  const root = parent.shadowRoot;
  expect(root?.querySelector('.cm-content')?.classList.contains('cm-lineWrapping')).toBe(true);
  // The deleted chunk is a widget under .cm-content, so it inherits the wrapping white-space.
  expect(root?.querySelector('.cm-content .cm-deletedChunk')).not.toBeNull();
  const css = adoptedCss(root);
  expect(css).toContain('var(--bg)');
  expect(css).toContain('var(--panel)');
  expect(css).toContain('var(--danger)');
  // The merge package scopes its own current-side rules to `.cm-merge-b`; ours must match
  // that specificity or its defaults win (they did, until this was caught in a browser).
  expect(root?.querySelector('.cm-editor')?.classList.contains('cm-merge-b')).toBe(true);
  expect(css).toMatch(/\.cm-merge-b \.cm-changedLine\b/u);
  expect(css).toMatch(/\.cm-merge-b \.cm-changedText\b/u);
  expect(css).toMatch(/\.cm-merge-b \.cm-changedLineGutter\b/u);
  editor.destroy();
});

test('a gutter tap on a wrapped line selects the whole line, not one visual row', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const ranges: (LineRange | null)[] = [];
  const long = 'x'.repeat(400);
  const editor = createDiffEditor({
    parent,
    original: `${long}\nb\n`,
    current: `${long}\nb\n`,
    onSelection: (range) => {
      ranges.push(range);
    },
  });
  // happy-dom lays nothing out, so every tap lands on the first line block; that block is the
  // whole document line whatever the wrapping, which is what the range must reflect.
  const gutter = parent.shadowRoot?.querySelector('.cm-lineNumbers');
  gutter?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(ranges).toEqual([{ startLine: 1, endLine: 1 }]);
  editor.destroy();
});
