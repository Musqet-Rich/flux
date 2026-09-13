import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// The one CodeMirror theme, shared by the diff view and the file editor. Colours are the app's
// custom properties from styles/base.css; they inherit into the editors' shadow roots, so there
// is no second palette to keep in step, and the tokens change under the editor with the scheme
// (ADR 0030). What the tokens do not cover is CodeMirror's own `&dark`/`&light` rules (the
// cursor, special characters, the merge view's, among others), and those it picks by the
// `dark` flag, so there is a theme per scheme and the editor's `setDark` swaps them when the
// scheme changes under an open editor: the system flipping at dusk, say.

const mergeRules = {
  // The unified merge view: the current side's changed lines read as additions, the deleted
  // chunk widgets as removals, the changed text within them underlined in the same hue. The
  // view marks its editor `cm-merge-b`, and the merge package's own rules for the current
  // side are scoped to that class (`&.cm-merge-b .cm-changedLine`, `&dark.cm-merge-b
  // .cm-changedText`, ...), so ours must be too or theirs win on specificity.
  '&.cm-merge-b .cm-changedLine': {
    backgroundColor: 'color-mix(in srgb, var(--ok) 14%, transparent)',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'linear-gradient(var(--ok), var(--ok)) bottom/100% 2px no-repeat',
  },
  '&.cm-merge-b .cm-changedLineGutter': { background: 'var(--ok)' },
  '.cm-deletedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--danger) 14%, transparent)',
  },
  '.cm-deletedChunk .cm-deletedText': {
    background: 'linear-gradient(var(--danger), var(--danger)) bottom/100% 2px no-repeat',
  },
  '.cm-deletedLineGutter': { background: 'var(--danger)' },
};

const spec = {
  '&': {
    // 13px at the default text size, following the device's size from there.
    fontSize: '0.87rem',
    height: '100%',
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
  },
  '.cm-scroller': { fontFamily: 'var(--font-code)' },
  // Neither editor uses drawSelection(), so the caret and the selection are the browser's
  // own: caret-color and ::selection are what style them, not .cm-cursor or
  // .cm-selectionBackground.
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-content ::selection, .cm-content::selection': {
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
  ...mergeRules,
  '.cm-collapsedLines': {
    color: 'var(--muted)',
    background: 'var(--panel)',
  },
};

// Built once each: a theme is a set of rules under a class of its own, and a switch that made
// a new one would add its rules to the editor's stylesheet every time.
const themes = { dark: EditorView.theme(spec, { dark: true }), light: EditorView.theme(spec) };

export const editorTheme = (dark: boolean): Extension => (dark ? themes.dark : themes.light);
