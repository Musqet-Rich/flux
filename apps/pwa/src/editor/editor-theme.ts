import { EditorView } from '@codemirror/view';

// The one CodeMirror theme, shared by the diff view and the file editor. Colours are the app's
// custom properties from styles/base.css; they inherit into the editors' shadow roots, so there
// is no second palette to keep in step. The app is dark-only (`color-scheme: dark`), so this
// theme is too: `dark: true` makes CodeMirror's own `&dark` rules (the merge view's, among
// others) apply where this theme has nothing to say.

export const editorTheme = EditorView.theme(
  {
    '&': {
      fontSize: '13px',
      height: '100%',
      backgroundColor: 'var(--bg)',
      color: 'var(--fg)',
    },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
    '.cm-content': { caretColor: 'var(--fg)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
      {
        backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
      },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--fg) 6%, transparent)' },
    '.cm-gutters': {
      backgroundColor: 'var(--panel)',
      color: 'var(--muted)',
      borderColor: 'var(--border)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--panel-2)',
      color: 'var(--fg)',
    },
    // The unified merge view: the current side's changed lines read as additions, the deleted
    // chunk widgets as removals, the changed text within them underlined in the same hue.
    '.cm-changedLine': {
      backgroundColor: 'color-mix(in srgb, var(--ok) 14%, transparent)',
    },
    '.cm-changedText': {
      background: 'linear-gradient(var(--ok), var(--ok)) bottom/100% 2px no-repeat',
    },
    '.cm-changedLineGutter': { background: 'var(--ok)' },
    '.cm-deletedChunk': {
      backgroundColor: 'color-mix(in srgb, var(--danger) 14%, transparent)',
    },
    '.cm-deletedChunk .cm-deletedText': {
      background: 'linear-gradient(var(--danger), var(--danger)) bottom/100% 2px no-repeat',
    },
    '.cm-deletedLineGutter': { background: 'var(--danger)' },
    '.cm-collapsedLines': {
      color: 'var(--muted)',
      background: 'var(--panel)',
    },
  },
  { dark: true },
);
