import type { EditorState } from '@codemirror/state';
import type { LineRange } from '@flux/protocol';

// The lines an editor selection covers, 1-based and inclusive (protocol.md § 5 CodeRef.range).
// An empty selection is no range; a selection ending at the very start of a line does not
// include that line, which is what a drag that stops at a line break looks like.

export const selectionRange = (state: EditorState): LineRange | null => {
  const { from, to } = state.selection.main;
  if (from === to) return null;
  const startLine = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to);
  const endLine = last.from === to ? last.number - 1 : last.number;
  return { startLine, endLine: Math.max(startLine, endLine) };
};
