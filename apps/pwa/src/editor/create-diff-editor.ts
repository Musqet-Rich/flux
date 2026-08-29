import { unifiedMergeView } from '@codemirror/merge';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { BlockInfo } from '@codemirror/view';
import { EditorView, lineNumbers } from '@codemirror/view';
import type { LineRange } from '@flux/protocol';

import { selectionRange } from './selection-range.ts';

// A read-only unified diff (ADR 0005) whose selection is reported as a line range for a comment.
// Lines are selected by dragging, or on a phone by tapping line numbers: one tap selects the
// line, a second tap on another line extends to it, a tap on the selected line clears.

export interface DiffEditor {
  destroy: () => void;
  clearSelection: () => void;
}

export interface DiffEditorOptions {
  parent: HTMLElement;
  original: string;
  current: string;
  onSelection: (range: LineRange | null) => void;
}

const gutterTap = (view: EditorView, line: BlockInfo): boolean => {
  const { from, to } = view.state.selection.main;
  const empty = from === to;
  const inside = !empty && line.from >= from && line.to <= to;
  const anchor = empty ? line.from : Math.min(from, line.from);
  const head = empty ? line.to : Math.max(to, line.to);
  view.dispatch({
    selection: inside ? EditorSelection.cursor(line.from) : EditorSelection.range(anchor, head),
  });
  return true;
};

const theme = EditorView.theme({
  '&': { fontSize: '13px', height: '100%' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  '.cm-gutters': { cursor: 'pointer', userSelect: 'none' },
});

export const createDiffEditor = (options: DiffEditorOptions): DiffEditor => {
  // CodeMirror injects its styles with a <style> tag when mounted in a document, which the
  // relay's CSP (default-src 'self', no unsafe-inline) blocks. Inside a shadow root it uses a
  // constructed stylesheet instead, which CSP does not govern, so the editor lives in one.
  const root = options.parent.shadowRoot ?? options.parent.attachShadow({ mode: 'open' });
  const view = new EditorView({
    root,
    parent: root,
    state: EditorState.create({
      doc: options.current,
      extensions: [
        lineNumbers({ domEventHandlers: { mousedown: gutterTap } }),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        unifiedMergeView({
          original: options.original,
          mergeControls: false,
          collapseUnchanged: { margin: 3, minSize: 6 },
        }),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) options.onSelection(selectionRange(update.state));
        }),
        theme,
      ],
    }),
  });
  return {
    destroy: () => {
      view.destroy();
    },
    clearSelection: () => {
      view.dispatch({ selection: EditorSelection.cursor(0) });
    },
  };
};
