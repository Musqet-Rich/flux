# Flux

Give coding agents their own computer. Steer and review them from your phone.

Flux runs Claude Code and pi.dev on a box you control with permissions bypassed, and gives you a small, fast remote GUI: agent chat, diffs with line comments, a file browser, one tab per worktree, and notifications when an agent needs you. The connection is end-to-end encrypted through a dumb relay you host — no accounts, no third parties.

Three parts: the **relay** on a VPS behind Caddy (forwards encrypted frames, serves the web app), the **daemon** on the box (runs the agents), and the **PWA** on your phone or laptop.

- **Run your own:** [`SELF_HOSTING.md`](SELF_HOSTING.md) — deploy the relay and the daemon.
- **Hack on it:** [`DEVELOPMENT.md`](DEVELOPMENT.md) — build, test, and the dev loop.
- **How it works:** [`docs/prd.md`](docs/prd.md), [`docs/architecture.md`](docs/architecture.md), [`docs/protocol.md`](docs/protocol.md), [`docs/engineering.md`](docs/engineering.md), [`docs/adr/`](docs/adr/).

Licence: MIT or Apache-2.0, at your option. See `LICENSE-MIT` and `LICENSE-APACHE`.

## Using Flux

Flux is self-hosted: once you have a relay on a VPS and a daemon on your box ([`SELF_HOSTING.md`](SELF_HOSTING.md)), everything below happens from the app in your browser.

### Pair a device

On the box, ask the running daemon for a pairing link:

```sh
sudo -u flux -i flux pair
```

That prints a QR code and the link it encodes, valid for ten minutes. On the phone, open `https://YOUR.DOMAIN`, tap **Scan QR code** (or paste the link), and accept the notification prompt when asked. Add the page to the home screen for a full-screen app; on iOS the home-screen install is also what enables push.

Pairing is per device — run `flux pair` again for each one. The gear in the app header opens **Settings**, which lists paired devices and revokes them; a revoked device is cut off at once and must pair again.

### The session

Each session is one agent working in its own git worktree, shown as a tab. Chat with the agent, watch it think and run tools, and answer when it asks a question. When an agent spawns subagents, they get their own chats, reached from the strip under the toolbar. Sessions can be renamed, archived, or have their context cleared from the session menu.

### Changes and files

The **Changes** screen lists the worktree's changed files. Open a diff to read it and leave line comments, tick files to narrow a commit, and commit, push, or open a PR (**Open PR** runs `gh` on the box). The **Files** screen browses the whole worktree — walk the tree, open any file, and edit it in place with an optimistic-concurrency check, not just the files that changed.

### Settings

The Settings screen edits what the box lets you change while it runs: the repositories directory, the default agent, and which events send a push. Values that only the environment sets (relay URL, data dir, push subject, the `claude` binary) are shown read-only. Below that are the agent's global `CLAUDE.md` and `settings.json` from the flux user's `~/.claude`, edited as text; `settings.json` is refused unless it is a JSON object.

### Notifications

The daemon sends Web Push straight to the browser's push service, encrypted per RFC 8291 (`docs/adr/0013`). It fires when an agent asks a question (`flux_ask`), reports done or blocked (`flux_notify`), or goes idle after working. If you dismissed the permission prompt, the status bar offers **Enable notifications**. iOS needs the app installed to the home screen for push.
