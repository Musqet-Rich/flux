import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';

import { editorTheme } from './editor-theme.ts';

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
  // Rebuilds the theme for the other scheme (editor-theme.ts), as the view does when the
  // system flips while the editor is open.
  setDark: (dark: boolean) => void;
}

export interface CodeEditorOptions {
  parent: HTMLElement;
  // Whether the app's scheme is dark at creation (ADR 0030); `setDark` follows it after.
  dark: boolean;
  doc: string;
  readOnly: boolean;
  onChange: () => void;
  // Mod-S, the save shortcut people expect on a laptop.
  onSave: () => void;
}

const readOnlyOf = (readOnly: boolean) => [
  EditorView.editable.of(!readOnly),
  EditorState.readOnly.of(readOnly),
];

// Everything but what a setter can change after creation (the compartments).
const fixedExtensions = (options: CodeEditorOptions) => {
  const save = (): boolean => {
    options.onSave();
    return true;
  };
  return [
    lineNumbers(),
    EditorView.lineWrapping,
    history(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    indentOnInput(),
    keymap.of([{ key: 'Mod-s', run: save }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange();
    }),
  ];
};

export const createCodeEditor = (options: CodeEditorOptions): CodeEditor => {
  // In a shadow root for the same reason as the diff editor: CodeMirror's injected <style> is
  // blocked by the relay's CSP in the document, and a constructed stylesheet is not.
  const root = options.parent.shadowRoot ?? options.parent.attachShadow({ mode: 'open' });
  const editable = new Compartment();
  const theme = new Compartment();
  const fixed = fixedExtensions(options);
  // What the compartments hold now, so a fresh state (setDoc) starts from it and not from
  // the options.
  let readOnly = options.readOnly;
  let dark = options.dark;
  const stateOf = (doc: string): EditorState =>
    EditorState.create({
      doc,
      extensions: [...fixed, editable.of(readOnlyOf(readOnly)), theme.of(editorTheme(dark))],
    });
  const view = new EditorView({ root, parent: root, state: stateOf(options.doc) });
  return {
    destroy: () => {
      view.destroy();
    },
    doc: () => view.state.doc.toString(),
    setDoc: (text) => {
      view.setState(stateOf(text));
    },
    setReadOnly: (next) => {
      readOnly = next;
      view.dispatch({ effects: editable.reconfigure(readOnlyOf(next)) });
    },
    setDark: (next) => {
      dark = next;
      view.dispatch({ effects: theme.reconfigure(editorTheme(next)) });
    },
    insert: (text) => {
      view.dispatch(view.state.replaceSelection(text));
    },
  };
};
