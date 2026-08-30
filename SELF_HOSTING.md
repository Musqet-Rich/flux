# Self-hosting Flux

Flux is two deployments you run yourself: the **relay** on a VPS (forwards encrypted frames and serves the web app) and the **daemon** on the box where the agents work. This guide sets both up with systemd on Ubuntu 24.04. For the app-side walkthrough once they are running, see [`README.md`](README.md); for the design, [`docs/architecture.md`](docs/architecture.md).

## Prerequisites

Both machines need Node 24 and git, and a DNS name (say `flux.example.com`) must point at the VPS. On Ubuntu 24.04, install Node from NodeSource so it lands at `/usr/bin/node`, which is what the systemd units run:

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

## Build

Both machines build from the same checkout:

```sh
git clone https://github.com/Musqet-Rich/flux.git
cd flux
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

That produces `apps/relay/dist/index.mjs`, `apps/daemon/dist/index.mjs` (+ `flux-mcp.mjs`, the MCP server Claude spawns, and `flux-pi-extension.mjs`, the pi extension with the same tools) and `apps/pwa/dist/`.

## Relay (VPS)

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

## Box (daemon)

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

Then pair a phone as described in [`README.md`](README.md) § Pair a device. Under systemd the daemon never prints a pairing link to the journal; it only does so when started on a terminal, so `flux pair` is how you mint one.

## Supervision and updates

`flux service install` writes the right supervisor manifest for the host — a systemd unit on Linux, a launchd LaunchAgent on macOS, or a restart-loop wrapper where there is no init system — so the daemon starts on boot, restarts on crash, and comes back after a self-update. On Linux as a non-root user it stages the unit and prints the exact `sudo` commands rather than escalating on its own. `flux service uninstall` reverses it and `flux service status` reports what is installed. This is an alternative to copying `deploy/flux-daemon.service` by hand above, and it is what lets a phone-triggered update restart the daemon into the new code.

Cutting a release, signing the daemon bundle, and how the daemon updates itself are covered in [`docs/releases.md`](docs/releases.md).
