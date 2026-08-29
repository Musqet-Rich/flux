# 0012: Pairing via QR in URL fragment, X25519 static keys, one-time secret

Status: accepted, 2026-08-28.

## Context

Pairing must be: run daemon, scan QR, connected. No accounts. The relay must learn nothing. Additional devices must be addable and revocable.

## Decision

- Box and each device hold static X25519 keypairs. Trust is the box's list of device public keys.
- Room id is `sha256(boxPub)` truncated, so the QR need not carry it.
- The QR encodes `https://<relay>/#<boxPub>.<secret>`. The fragment never reaches the server. Opening the URL loads the PWA and triggers pairing, and on Android prompts install.
- `secret` is 16 random bytes, single use, 10 minute expiry. The device proves possession with an HMAC over both public keys. Without it, knowing `boxPub` (which anyone who ever saw a QR knows) grants nothing.
- Per-connection keys derive from static-static plus ephemeral-ephemeral X25519 through HKDF, giving mutual authentication and forward secrecy with WebCrypto only. See `protocol.md` § 3.

A custom URL scheme (`flux://`) was rejected: needs the app installed first and Android handling is unreliable. A path instead of a fragment was rejected because it lands in server access logs.

## Consequences

- `flux pair` prints a fresh QR; `flux devices ls|rm` manage trust.
- Losing the box's private key means re-pairing every device; it is backed up with the SQLite database.
- QR payload is ~90 characters, comfortably renderable in a terminal.
