# 0029: Phosphor icons, one path string each, through an in-house `Icon` component

Status: accepted, 2026-09-12.

## Context

Every control in the PWA was a word (`Send`, `Files`, `Refresh`, `Stop`) or a unicode character standing in for an icon (`⚙`, `ⓘ`, `>_`, `×`, `⋯`, `↻`, `‹`, `○`, `✗`, `📄`). On a phone the words cost the space the operator wants for the timeline and the branch, and the characters render differently per platform font (an emoji on one, a hollow glyph on another, a missing-glyph box on a third). The operator asked for an icon set with enough choice that the app does not look like every other one, and named Phosphor.

Phosphor ships two npm shapes. `@phosphor-icons/vue` is a component per icon, each bundling all six weights (about 4.5 kB of path data per icon), behind an `exports` map that exposes only the barrel, so an application cannot import one icon by path and tree-shaking is the bundler's promise alone; the operator has seen that promise fail and every icon ship. `@phosphor-icons/core` is the raw SVG files, one per icon per weight, each exported by path (`@phosphor-icons/core/regular/x.svg`), and every regular icon (and all but eight of the fill weight) is exactly one `<path d="…"/>` on a `0 0 256 256` viewBox with `fill="currentColor"`.

The PWA renders no HTML it did not build itself (`markdown/`, `ansi/`: no `v-html`), so an SVG file cannot simply be inlined as markup either.

## Decision

1. **`@phosphor-icons/core` is the icon source; nothing of it ships.** A small Vite plugin in `apps/pwa/vite.config.ts` (`iconPath`, `enforce: 'pre'`) resolves `<icon>.svg?path` to the file's one path string as a module (`export default "M…"`), refusing at build time any file that is not exactly one path. An icon costs its `d` attribute, about 300 bytes; no package code, no component per icon, no barrel of 1,500 for the bundler to shake.

2. **`src/icons/icons.ts` is the whole icon vocabulary, keyed by meaning.** One import per icon in use (`?path`), one map entry naming what the icon means in this UI (`close`, `send`, `back`, `menu`, `succeeded`), not what it draws. A component says `<Icon name="close" />` and which glyph "close" is lives in one place; adding an icon is one import and one key. The map is the one file allowed past the import-count lint, and by construction every entry in it is used, so it is not a barrel: it is the set.

3. **`components/Icon.vue` draws it.** One `<svg viewBox="0 0 256 256"><path :d /></svg>`, `fill: currentColor`, sized in `em` so it sits in a button or a line of text like a character would. Always `aria-hidden`: the control around it carries the accessible name. An icon-only button carries `aria-label` and `title`, and `styles/base.css` has `button.icon-only` for its square padding.

4. **What became an icon.** Every glyph character (header buttons, close and remove crosses, overflow dots, chevrons, the renewal and reply arrows, the catch-up pill's arrow, the file-chip emoji, the agent strip's state marks, the editor's unsaved dot, the verified tick). Icon-only, with the name on `aria-label`/`title`: the session toolbar (Stop, Files, Changes with its count beside the icon, the PR link with its number), every screen's back button, Refresh, Edit, Copy, Run, the composer's Send, the sound picker's Play, the attachment chips' Retry and remove. Icon and word: menu items (Rename, Clear context, Archive, Delete; Copy, Reply), the confirms (Delete, Discard changes), Save, Commit, Push, Open PR, Reopen, Add agent, Add skill, Enable notifications, Start agent, Pair, Scan QR code. Timeline signal rows (a task, its report as succeeded or failed, a PR, a failed hook, a compaction) open with an icon; plain lifecycle notes do not. The unpaired landing page keeps its terminal look, and `·` separators, git status letters and `$` prompts stay text.

## Consequences

- The header and every toolbar fit a phone width without wrapping; the words the operator reads are the branch, the timeline and the file names.
- Accessible names are unchanged or better: the e2e flow and the component tests select controls by role and name, and a back button now says where it goes (`Back to session`) rather than `‹ Session`.
- Regular weight everywhere. A weight change is one path in `icons.ts` (`fill/circle-fill` is the one fill icon, for the status dots). Duotone icons are two paths, as are eight of the fill weight; the plugin refuses them at build time and would need extending to draw them. None are used.
- `@phosphor-icons/core` is a dev dependency (ADR 0010 ledger): it is read at build time and is absent from the output. Its version pins the icon drawings, so an upgrade is a visible change to review.
- `EventItem.vue` gave its event-to-row mapping to `describe-event.ts` (`describeEvent`, the `EventView` shape in `event-view.ts`) to stay within the file limit with icons added; the mapping is pure and tested without a mount (`describe-event.test.ts`). `SessionView.vue` gave its scroller to `SessionTimeline.vue` (rows, live bubble, ask card, catch-up pill, and the tail-following) and `Shell.vue` its header to `AppHeader.vue`, for the same reason: with an `Icon` import each, both were over the ten-import budget.
