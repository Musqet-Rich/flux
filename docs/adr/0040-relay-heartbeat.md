# 0040: The relay pings every socket and drops the ones that stop answering

Status: accepted, 2026-11-16. Updates ADR 0037's note that neither side sends a heartbeat.

## Context

On 2026-11-16 a box rebooted and its daemon could not get back into its room. The old socket had died without a close (the machine went down mid-connection), so the relay still held it as the room's host, and protocol.md § 2 allows one host per room: every reconnect was refused `host_present`, and the daemon retried every 30 seconds for as long as the relay kept the dead socket. Nothing on the relay checked whether a socket was alive, so that lasted until TCP or the reverse proxy in front of the relay gave up: minutes at best, never if the proxy keeps its upstream connection open. Guests that vanish the same way also hold one of the room's eight guest places. ADR 0037 had already noted the gap: a sleeping daemon looks present for minutes.

The other fix considered was to let a host join with the room's token replace the host already there. Any device that has ever paired with the box knows its public key, and the token is derived from it, so a revoked device could keep knocking the real box off the relay. It could read nothing, since frames are end-to-end encrypted, but it could deny service at will. Rejected.

## Decision

1. **The relay pings every socket every 30 seconds** (a WebSocket ping frame, `heartbeatMs` in `createRelayServer`) **and terminates one that has not answered the previous ping.** Termination runs the socket's normal close, so a host's leaving frees the host slot and tells the guests `host_left`, and a guest's frees its place.
2. **No protocol, daemon or PWA change.** WebSocket clients answer pings themselves, the daemon's platform WebSocket and every browser alike, so a daemon or PWA of any version benefits once the relay is redeployed.

## Consequences

- A box that vanished is dropped in 30 to 60 seconds, by where in the interval it went, and the daemon's next retry, at most 30 seconds later, gets the room back: recovery in about 90 seconds at worst, from never.
- A guest whose network dropped without a close is likewise dropped in 30 to 60 seconds, freeing its place, and a daemon that slept stops looking present to devices after the same 30 to 60 seconds (ADR 0037's "for minutes, until TCP gives up").
- A peer has one interval to answer. A live one whose pong arrives more than 30 seconds late is dropped and reconnects: a pong queues behind frames already on their way to it, so this could hit a device on a very slow link (well under 1 Mbit/s) receiving the largest frames. One missed ping is the trade for the quicker recovery; allowing two would double the time a dead box holds its room.
- A box that sleeps is now dropped while it sleeps, where before it often woke to the same connection. On waking, the daemon learns the socket is gone on its next write or its TCP keepalive (the platform WebSocket's is 60 seconds), then reconnects, so it shows as offline for a minute or two after waking.
- One ping frame per socket per 30 seconds: a few bytes, no measurable load. The interval also keeps idle connections busy for proxies that close silent sockets.
- The daemon's side, a relay that vanished without a close, is ADR 0041: the daemon watches these pings and gives up a relay that stops sending them.
