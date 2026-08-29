# 0005: CodeMirror 6, not Monaco

Status: accepted, 2026-08-28.

## Context

The primary surface is a phone reviewing diffs and leaving line comments; desktop is secondary. Needs: diff view, line selection, gutter decorations for comments, syntax highlighting, small bundle, good touch behaviour, later a light editor.

## Decision

CodeMirror 6 with `@codemirror/merge` for diffs. Monaco rejected: ~5 MB, desktop-oriented, weak touch handling, heavy worker setup.

## Consequences

- `@codemirror/*` packages are approved runtime dependencies; language packs added per need and ledgered.
- Comment gutters and selection-to-CodeRef mapping are custom CM6 extensions in `apps/pwa/src/editor/`.
