import { EditorSelection, EditorState } from '@codemirror/state';
import { expect, test } from 'vitest';

import { selectionRange } from './selection-range.ts';

const doc = 'one\ntwo\nthree\n';
const at = (anchor: number, head: number) =>
  EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });

test('maps a selection to 1-based inclusive lines', () => {
  expect(selectionRange(at(0, 0))).toBeNull();
  expect(selectionRange(at(0, 3))).toEqual({ startLine: 1, endLine: 1 });
  expect(selectionRange(at(1, 6))).toEqual({ startLine: 1, endLine: 2 });
  expect(selectionRange(at(6, 1))).toEqual({ startLine: 1, endLine: 2 });
  expect(selectionRange(at(0, 4))).toEqual({ startLine: 1, endLine: 1 });
  expect(selectionRange(at(4, 14))).toEqual({ startLine: 2, endLine: 3 });
});
