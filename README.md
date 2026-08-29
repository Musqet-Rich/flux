# Flux

Give coding agents their own computer. Steer and review them from your phone.

Flux runs Claude Code and pi.dev on a box you control with permissions bypassed, and gives you a small, fast remote GUI: agent chat, diffs with line comments, one tab per worktree, notifications when an agent needs you. Connection is end-to-end encrypted through a dumb relay you host; no accounts, no third parties.

Three parts: the **relay** on a VPS behind Caddy (forwards encrypted frames, serves the web app), the **daemon** on the box (runs the agents), and the **PWA** on your phone or laptop. Design and rules: [`docs/prd.md`](docs/prd.md), [`docs/architecture.md`](docs/architecture.md), [`docs/protocol.md`](docs/protocol.md), [`docs/engineering.md`](docs/engineering.md), [`docs/adr/`](docs/adr/).

Licence: MIT or Apache-2.0, at your option. See `LICENSE-MIT` and `LICENSE-APACHE`.

## Quickstart

Both machines need Node 24 and git, and a DNS name (say `flux.example.com`) must point at the VPS. On Ubuntu 24.04, install Node from NodeSource so it lands at `/usr/bin/node`, which is what the systemd units run:

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

Both machines build from the same checkout:

```sh
git clone https://github.com/Musqet-Rich/flux.git
cd flux
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

That produces `apps/relay/dist/index.mjs`, `apps/daemon/dist/index.mjs` (+ `flux-mcp.mjs`, the MCP server Claude spawns, and `flux-pi-extension.mjs`, the pi extension with the same tools) and `apps/pwa/dist/`.

### Relay (VPS)

Checkout at `/opt/flux`, built as above, with [Caddy](https://caddyserver.com) installed.

```sh
sudo useradd --system --no-create-home flux
sudo install -d -m 750 -o root -g flux /etc/flux
sudo install -m 640 -o root -g flux deploy/.env.example /etc/flux/flux.env
sudo cp deploy/flux-relay.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now flux-relay
sed 's/flux.example.com/YOUR.DOMAIN/' deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl https://YOUR.DOMAIN/healthz
```

The relay listens on `127.0.0.1:8787`; Caddy terminates TLS and proxies the WebSocket. The unit sets `FLUX_TRUST_PROXY=1` so the relay's per-IP connection limit counts the address Caddy forwards rather than `127.0.0.1` for everyone. It stores nothing.

### Box (daemon)

The daemon runs as a `flux` user whose home holds the repositories and the agent logins (Claude Code, and pi authenticated for a provider: `pi auth check --provider anthropic` should say `ready`). Install either agent or both; the daemon offers what it finds on PATH. Checkout at `/home/flux/flux`. The box needs `git`, `claude` and/or `pi`, and `gh` on the daemon's PATH: `gh` (logged in as `flux`) is what "Open PR" in the PWA runs; without it commit and push still work and Open PR reports that `gh` is missing.

```sh
sudo useradd --create-home --shell /bin/bash flux
sudo -u flux -i                     # as flux: install claude and/or pi, and gh; log in to each; put repos in ~/repos
git clone https://github.com/Musqet-Rich/flux.git && cd flux
corepack pnpm install --frozen-lockfile && corepack pnpm run build
exit
sudo ln -s /home/flux/flux/apps/daemon/dist/index.mjs /usr/local/bin/flux
sudo install -d -m 750 -o root -g flux /etc/flux
sudo install -m 640 -o root -g flux deploy/.env.example /etc/flux/flux.env
sudoedit /etc/flux/flux.env         # uncomment and set FLUX_RELAY_URL=https://YOUR.DOMAIN
sudo cp deploy/flux-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now flux-daemon
sudo journalctl -u flux-daemon -n 5  # "flux daemon: relay https://YOUR.DOMAIN"
```

One daemon per data directory: a second `flux daemon` on the same `FLUX_DATA_DIR` refuses with exit 3 and names the pid that holds it (`~/.flux/daemon.lock`; a stale lock from a crashed daemon is replaced). `systemctl restart` stops the old one first; if you run it by hand, wait for the old process to exit before starting another.

`deploy/.env.example` documents every `FLUX_*` variable. The unit hardens what it can; it cannot lock the filesystem or filter system calls because agents write to it and sandbox themselves. Read the comments before running it on a shared machine.

### Pair a phone

```sh
sudo -u flux -i flux pair
```

That prints a QR code and the link it encodes, valid for ten minutes. On the phone, open `https://YOUR.DOMAIN`, tap **Scan QR code** (or paste the link), and accept the notification prompt when asked. Add the page to the home screen for a full-screen app. Pairing is per device: run `flux pair` again for each one. The gear in the app's header opens **Settings**, which lists paired devices and revokes them (a revoked device is cut off at once and must pair again); the box can do the same with `sudo -u flux -i flux devices ls` and `flux devices rm <id>` (which asks the running daemon, so the device is cut off at once; with no daemon running it edits the database and says so). Under systemd the daemon never prints a pairing link to the journal; it only does so when started on a terminal.

### Settings

The same screen edits what the box lets you change while it runs: the repositories directory, the default agent, and which events send a push (questions, idle, done/blocked). Values that only the environment sets (relay URL, data dir, push subject, `claude` binary) are shown read-only. Below that are the agent's global `CLAUDE.md` and `settings.json` from the flux user's `~/.claude`, edited as text; `settings.json` is refused unless it is a JSON object.

### Notifications

Web Push is sent by the daemon itself, straight to the browser's push service, encrypted per RFC 8291 (`docs/adr/0013`). It fires when an agent asks a question (`flux_ask`), reports done or blocked (`flux_notify`), or goes idle after working. If you dismissed the permission prompt, the status bar offers **Enable notifications**. iOS needs the app installed to the home screen for push.

## Development

```sh
corepack pnpm install
corepack pnpm run check     # fmt, lint, typecheck, tests with coverage: the pre-commit gate
corepack pnpm run build     # daemon, relay, pwa, in dependency order
corepack pnpm --filter @flux/pwa dev
```

Run the daemon from source with `FLUX_RELAY_URL=http://127.0.0.1:8787 node apps/daemon/src/index.ts` (Node strips the types) against `node apps/relay/src/index.ts`. A plain `http://` relay is only accepted on loopback (`localhost`, `127.0.0.1`, `::1`); anywhere else the daemon refuses to start (`insecure_transport`) and the app refuses the pairing link, so a deployed relay is always `https://`. `apps/daemon/test/built-daemon.test.ts` builds the daemon into a temp dir and runs the result, so a broken production build fails `pnpm run check`.

To work on the PWA with hot reload, run the three parts in three terminals:

```sh
corepack pnpm run build && node apps/relay/dist/index.mjs                      # relay on :8787
FLUX_RELAY_URL=http://127.0.0.1:8787 FLUX_DATA_DIR=/tmp/flux-dev node apps/daemon/dist/index.mjs  # or apps/daemon/src/index.ts
corepack pnpm --filter @flux/pwa dev                                            # Vite on :5173
```

The dev server proxies `/ws` and `/healthz` to the relay (`FLUX_DEV_RELAY` overrides `http://127.0.0.1:8787`), so the app reaches the box through its own origin just like the built one. To pair, take the link the daemon prints at start-up on a terminal (or `FLUX_DATA_DIR=/tmp/flux-dev node apps/daemon/dist/index.mjs pair`; `pair` finds the running daemon through the control socket in that directory), which has origin `http://127.0.0.1:8787`, and open `http://localhost:5173/#<fragment>` with the same fragment; the app pairs from the fragment on load. Edits to components then hot-reload without dropping the paired connection. The service worker is not registered under the dev server, so there are no push notifications there.
