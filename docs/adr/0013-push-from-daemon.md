# 0013: The daemon sends Web Push itself; the relay holds no subscriptions

Status: accepted, 2026-08-29. Amends `architecture.md` § Relay and § Notifications and `protocol.md` § 2.

## Context

The design had the relay store Web Push subscriptions and send pushes on the box's request, so that the relay held "one kind of state, and only a cache". Building it showed the split buys nothing: Web Push requires the sender to hold the subscription's keys to encrypt the payload (RFC 8291) and to sign a VAPID token (RFC 8292), so the box must have the subscriptions anyway, and a POST to the push service from the box is no harder than a POST to the relay.

## Decision

- Subscriptions are stored on the box (`push_subscriptions` in the daemon's SQLite) via the `push.subscribe` RPC, per paired device.
- The daemon encrypts and signs pushes with WebCrypto and POSTs them straight to the push service endpoints.
- The relay has no `/push` routes and holds no state at all beyond live connections. `protocol.md` § 2's Web Push section is withdrawn.
- The VAPID public key the PWA needs to subscribe is returned by the `hello` RPC (`vapidPublicKey`).

## Consequences

- The relay's threat model is simpler still: it holds nothing an attacker could read.
- The box needs outbound HTTPS to the push services (it already needs it to reach the relay).
- Push endpoint URLs now live on the box, which is fully trusted.
