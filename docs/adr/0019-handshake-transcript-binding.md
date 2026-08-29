# 0019: Handshake transcript bound into key derivation; TLS-only transport

Status: accepted, 2026-08-29. Extends 0003 and 0012; supersedes neither.

## Context

ADR 0012 derived per-connection keys from static-static and ephemeral-ephemeral X25519 through HKDF with `salt = nonceD || nonceB` and `info = "flux-v1-" || roomId`. A review (2026-08-29) found two gaps:

1. The public keys and nonces were bound (they feed the DH or the salt), but the hello fields `v` and `to` were not bound at all. A relay, or anything on the path, could rewrite the version a peer claimed or the fingerprint a box hello was addressed to without either side noticing at handshake time; the damage only showed later as a decrypt failure, which the box treated like any stray frame and the device like a channel that never came up. There was no explicit key confirmation: the box kept a channel whose first frame never opened.
2. Nothing stopped either end from opening `ws://` to a relay on the public internet. The frames are end-to-end encrypted, but a plaintext transport shows the path the room id and both handshake hellos, and lets it drop or replay handshakes.

## Decision

- **Transcript binding.** `info = "flux-v2" || SHA-256(helloD || helloB)`, where `helloD` and `helloB` are the two handshake payloads exactly as sent on the wire, hashed as received rather than re-serialised. Salt unchanged. Every byte of both hellos is now authenticated, `v` and `to` included; a tampered hello gives the two sides different keys. `roomId` leaves `info`: it is a hash of `boxPub`, already bound through the static-static agreement. Layout and the list of authenticated fields are in `protocol.md` § 3.
- **Key confirmation without a round trip.** The device's first data frame remains the `hello` RPC, nonce 0. A nonce-0 frame that opens on none of a device's channels is a failed confirmation: the box drops every channel of that device still waiting for its first frame. A failed frame with a later nonce drops nothing, so a stray or corrupt frame cannot cut a working channel.
- **Protocol version 2.** Key derivation changed, so v1 and v2 peers cannot talk; `protocolVersion` is 2 in the relay join, both hellos and the `hello` RPC. The hello guards accept any positive `v` so a peer on another version still parses: the box answers a mismatched device hello with its own version and no channel, and the device reports `bad_version` ("Box is on protocol 1; update it", or "update this app" when the box is ahead) as a standing connection error and retries at the full backoff. A version 1 box is refused by a version 2 relay at the join; the daemon logs the refusal with the hint. This is the first bump, and the one mismatch it cannot explain on the device is a v1 box behind a v2 relay, which the device sees only as "Box offline": the v1 code never answers a v2 hello. From v2 on the mismatch is explained on both sides.
- **TLS-only transport.** `relayEndpoint.websocket` in the protocol package turns the configured relay origin into the room's WebSocket URL and throws `insecure_transport` for `ws://` (or `http://`) unless the host is `localhost`, `127.0.0.1` or `::1`. The daemon applies it to `FLUX_RELAY_URL` at start (exit 2 with the reason), the device to the pairing link's origin before opening a socket, and a stored box whose relay is refused lands on the pair screen with the reason. Development on `localhost:5173` and `127.0.0.1:8787`, and the e2e harness, keep working.

Pairing (`pairing.ts`, ADR 0012) is untouched: the pairing proof covers `devPub` and `boxPub` under the one-time secret and needs nothing from the transcript.

## Consequences

- Devices do not re-pair: static keys are unchanged. Every peer must be on version 2: update the relay and daemon together, then reload the app (the relay serves it, so it is never behind the relay).
- The handshake costs one SHA-256 more per connection. Nothing else on the wire changed; the frame layout, AAD and nonce scheme are as before.
- Out of scope, still: rekeying within a connection (connections are short and ephemerals are fresh per connection), hiding from the relay which guests share a device (the fingerprint is in the clear by design, ADR 0003), and the compress-then-encrypt length leak already accepted in `protocol.md` § 3.
- A channel dropped for a failed confirmation is silent on the box; the device's `hello` call times out and its keepalive would too. The device retries the handshake on its next socket drop; forcing one on a `hello` timeout is a follow-up if it turns out to matter.
