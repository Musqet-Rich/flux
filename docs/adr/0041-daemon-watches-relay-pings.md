# 0041: The daemon gives up a relay whose pings stop

Status: accepted, 2026-11-16. Completes ADR 0040's open consequence: the daemon's side of the relay heartbeat.

## Context

ADR 0040 made the relay ping every socket every 30 seconds and drop the ones that stop answering, so a dead box frees its room. The other direction stayed blind. A relay that vanishes without closing its sockets (its host rebooted, the network between went down, the reverse proxy lost its upstream) leaves the daemon's socket open and the daemon reporting itself connected, for as long as TCP takes to notice: minutes, longer behind a proxy. No device can reach the box meanwhile, and the daemon does not reconnect because nothing tells it to. The PWA already covers its own side: its `hello` keepalive (ADR 0019) drops a channel the box stops answering.

The daemon's client is Node's platform WebSocket (undici), the WHATWG API: it answers pings itself but neither shows them to the page nor can send one. Two ways were weighed. A wire heartbeat (a text `ping` the relay answers with `pong`) needs a protocol change, a relay that advertises it in its join reply (today's relay closes a socket that sends text after the join), and changes to the protocol package, the relay and the daemon. Watching the relay's own pings needs none of that: undici publishes each ping it receives on the `undici:websocket:ping` diagnostics channel, with the socket it came on, from undici 7.12 (Node 24.5 and later, and every Node 26).

## Decision

1. **The daemon watches the relay's pings** through `node:diagnostics_channel` (`undici:websocket:ping`), subscribed while the transport runs and matched to its current socket.
2. **The first ping on a socket arms a watchdog; each ping resets it; 75 seconds without one gives the socket up** (`relaySilenceMs`): the daemon forgets it at once, says so on the console, closes it without waiting for the close, and reconnects with its usual backoff. 75 seconds is two missed pings and a margin, so one slow ping does not cost a reconnect.
3. **A socket that has never been pinged is never judged**, so a daemon connected to a relay built before ADR 0040 behaves as before.

## Consequences

- No wire change: an updated daemon works with any relay, and gains the check once the relay pings.
- A relay that died silently is given up 75 seconds after its last ping, 45 to 75 seconds after it died, and the daemon is back as soon as a relay answers its reconnect.
- The given-up socket is closed but lingers half-closed until TCP gives up on it (the platform WebSocket has no way to destroy one): one file descriptor per occurrence, for minutes.
- The check rests on undici's diagnostics channel, not the WebSocket standard, and undici marks its diagnostics channels experimental. On Node 24.0 to 24.4 the message has no socket, so the check never arms; a Node that renamed or dropped the channel would turn it off the same way. Either way the daemon behaves as it did before this ADR, never worse. The transport's test fails if pings stop arriving on the channel, so a Node upgrade that breaks it shows in CI: the Node 24 jobs (`.node-version`) block a merge, the Node 26 ones only report.
- A daemon whose own event loop stalls for 75 seconds (a long synchronous job) would reconnect needlessly on recovery; the daemon does no such work.
