# 0033: Split panes on a wide screen: the chat beside a pane of Changes and Files

Status: accepted, 2026-09-13.

## Context

The PWA was built for a phone, one screen at a time: the chat, and in its place Changes, the file browser, a diff or the editor, each reached by a route under the session's and each with a Back. On a laptop or a monitor the same layout stretches the chat across the whole width, which a conversation does not need, and every look at a file or a diff replaces the chat, losing its scroll and the caret in the draft.

## Decision

1. **A wide screen splits.** At 64rem of the browser's default font size, 1024px, and above (`composables/useWide`, a media query, whose rem is the browser's and not the app's, so a window resized across the line switches live), the chat stays on the left and a panel route (`changes`, `files`, `diff`, `edit`) opens a pane on the right holding that screen under a strip of two tabs, Changes and Files (navigation, not an ARIA tablist: each is a route, the lit one `aria-current`), and a close. A diff belongs to Changes and the editor to wherever it was opened from (its `dir`), so the parent tab is the lit one. Below 64rem nothing changes: the phone keeps its screens.

2. **The route stays the one source of truth.** Nothing is added to the URL and no state says whether the pane is open: the chat route alone is the pane closed, a panel route is the pane open on that screen. So deep links, the toolbar's Files and Changes buttons, the browser's Back and the views' own Back all work unchanged in both layouts; only a Back whose target is the chat is hidden in the pane, since the chat is beside it. The chat stays mounted across pane changes, keeping its scroll and its draft.

3. **The divider is the device's.** A `role="separator"` bar between the panes is dragged with the pointer captured, and stepped with ← and → from the keyboard; the chat's share of the width, clamped to 30–70% so neither pane can vanish and both floored at 24rem of the app's (360px, so the two floors fit the narrowest wide screen), is sized live and kept in the device's storage when let go (`store/split-at.ts`), like the send key: a laptop and a monitor want different splits, and the box has no business with either.

## Consequences

- `SessionScreens` lays out; the panel routes' switch moves to `SessionPanel`, which draws the tab strip when paned. `ChangesView` and `FilesView` take a `paned` flag to hide their Back to the chat.
- The editor beside the chat means a file can be read or changed while the agent's reply is watched, the case the split is for.
- The chat is one element in one place whichever the width, so opening and closing the pane keep its scroll and draft. A flip of the width itself (a window dragged across 64rem) while a panel route is up does remount the chat, since a phone has no chat on that route; the panel stays as it was.
- An Escape pressed in the pane, in the editor say, is the pane's: the chat's Esc-to-Stop takes only a key from its own screen or from nowhere in particular.
- No pane state survives a reload beyond the route: reloading `/s/<id>/changes` on a wide screen opens the pane on Changes, on a phone the Changes screen, as before.
- The tab strip's two tabs are the panel's two roots. A third root (a terminal, say) would be a third tab, not a change of shape.
