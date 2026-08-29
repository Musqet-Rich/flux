import type { LineRange } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createDiffEditor } from './create-diff-editor.ts';

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
