# 0003: Dumb relay with end-to-end encryption, box as sole source of truth

Status: accepted, 2026-08-28.

## Context

Neither the box nor the phone is reachable from the internet. Options considered: raw sockets plus a custom relay, Tailscale/Headscale, iroh, Cloudflare Workers, a self-hosted WebSocket relay. Requirements: no third-party accounts, no new paid infra, no Rust in the build, browser-compatible, simple to run for years.

## Decision

A self-hosted WebSocket relay on the operator's existing VPS. It forwards opaque binary frames within a room and holds no state other than Web Push subscriptions (a cache the box repopulates). All application traffic is end-to-end encrypted between box and device with keys the relay never sees. The box is the only source of truth; the relay never buffers messages. If the box is offline the remote is offline by design.

iroh was the strongest alternative: it removes the VPS and gives direct paths after hole punching. Rejected because it puts Rust in the build (Tauri or FFI for mobile), browsers can only reach it via relay anyway, and it still depends on a third party's relays. Tailscale rejected for requiring accounts. Cloudflare Workers rejected by operator preference for self-hosting.

## Consequences

- Relay is ~200 lines and can be rewritten in an afternoon.
- Traffic is always relayed; fine at chat and diff payload sizes.
- The relay also serves the PWA, so there is exactly one thing to deploy on the VPS.
- Sync is by gapless `seq` and a `since` cursor; see `protocol.md`.
