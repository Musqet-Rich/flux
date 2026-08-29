import { expect, test } from 'vitest';

import { createCodeEditor } from './create-code-editor.ts';

const cmContent = (parent: HTMLElement): HTMLElement | null | undefined =>
  parent.shadowRoot?.querySelector('.cm-content');

const adoptedCss = (parent: HTMLElement): string =>
  (parent.shadowRoot?.adoptedStyleSheets ?? [])
    .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
    .join('\n');

test('mounts in a shadow root, edits the document, and reports changes', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  let changes = 0;
  let saves = 0;
  const editor = createCodeEditor({
    parent,
    doc: 'a\nb\n',
    readOnly: false,
    onChange: () => {
      changes += 1;
    },
    onSave: () => {
      saves += 1;
    },
  });
  expect(parent.shadowRoot?.querySelector('.cm-editor')).not.toBeNull();
  expect(document.head.querySelector('style')).toBeNull();
  expect(cmContent(parent)?.getAttribute('contenteditable')).toBe('true');
  expect(editor.doc()).toBe('a\nb\n');
  editor.insert('x');
  expect(editor.doc()).toBe('xa\nb\n');
  expect(changes).toBe(1);
  editor.setDoc('c\n');
  expect(editor.doc()).toBe('c\n');
  expect(changes).toBe(1);
  // Mod is Cmd on a Mac and Ctrl elsewhere; whichever this platform is, exactly one fires.
  const content = cmContent(parent);
  content?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));
  content?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  expect(saves).toBe(1);
  editor.destroy();
  expect(parent.shadowRoot?.querySelector('.cm-editor')).toBeNull();
});

test('wraps long lines and wears the shared theme', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createCodeEditor({
    parent,
    doc: 'x'.repeat(400),
    readOnly: false,
    onChange: () => {},
    onSave: () => {},
  });
  expect(cmContent(parent)?.classList.contains('cm-lineWrapping')).toBe(true);
  const css = adoptedCss(parent);
  expect(css).toContain('var(--bg)');
  expect(css).toContain('var(--panel)');
  editor.destroy();
});

test('read-only can be set at mount and toggled later', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createCodeEditor({
    parent,
    doc: 'x',
    readOnly: true,
    onChange: () => {},
    onSave: () => {},
  });
  expect(cmContent(parent)?.getAttribute('contenteditable')).toBe('false');
  editor.setReadOnly(false);
  expect(cmContent(parent)?.getAttribute('contenteditable')).toBe('true');
  editor.setReadOnly(true);
  expect(cmContent(parent)?.getAttribute('contenteditable')).toBe('false');
  editor.destroy();
});
