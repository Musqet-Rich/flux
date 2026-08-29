import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';

// A plain text editor (ADR 0005) for one worktree file: the document, whether it may be
// edited, and a change signal. No language packs yet; highlighting is one line each when added.

export interface CodeEditor {
  destroy: () => void;
  doc: () => string;
  // Replaces the document and the undo history, as after a reload.
  setDoc: (text: string) => void;
  setReadOnly: (readOnly: boolean) => void;
  // Replaces the selection (or inserts at the cursor) as typing would: undoable, and reported
  // through onChange. It is how tests edit without a keyboard.
  insert: (text: string) => void;
}

export interface CodeEditorOptions {
  parent: HTMLElement;
  doc: string;
  readOnly: boolean;
  onChange: () => void;
  // Mod-S, the save shortcut people expect on a laptop.
  onSave: () => void;
}

const theme = EditorView.theme({
  '&': { fontSize: '13px', height: '100%' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
});

const readOnlyOf = (readOnly: boolean) => [
  EditorView.editable.of(!readOnly),
  EditorState.readOnly.of(readOnly),
];

export const createCodeEditor = (options: CodeEditorOptions): CodeEditor => {
  // In a shadow root for the same reason as the diff editor: CodeMirror's injected <style> is
  // blocked by the relay's CSP in the document, and a constructed stylesheet is not.
  const root = options.parent.shadowRoot ?? options.parent.attachShadow({ mode: 'open' });
  const editable = new Compartment();
  const save = (): boolean => {
    options.onSave();
    return true;
  };
  const extensions = [
    lineNumbers(),
    history(),
    highlightActiveLine(),
    bracketMatching(),
    indentOnInput(),
    keymap.of([{ key: 'Mod-s', run: save }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    editable.of(readOnlyOf(options.readOnly)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange();
    }),
    theme,
  ];
  const stateOf = (doc: string): EditorState => EditorState.create({ doc, extensions });
  const view = new EditorView({ root, parent: root, state: stateOf(options.doc) });
  return {
    destroy: () => {
      view.destroy();
    },
    doc: () => view.state.doc.toString(),
    setDoc: (text) => {
      view.setState(stateOf(text));
    },
    setReadOnly: (readOnly) => {
      view.dispatch({ effects: editable.reconfigure(readOnlyOf(readOnly)) });
    },
    insert: (text) => {
      view.dispatch(view.state.replaceSelection(text));
    },
  };
};
