# 0038: No localhost preview in Flux: the operator brings their own tunnel

Status: accepted, 2026-11-01.

## Context

An agent working on a web app runs its dev server on the box, on `localhost:<port>`. The operator, on a phone, wants to see it: a third tab after Changes and Files showing the running app was the request. The box is reached only through the relay, which by design forwards end-to-end encrypted frames it cannot read (ADR 0003), and the PWA is served by the relay from one origin.

Three ways to bring the app to the phone were weighed:

1. **A service worker in the PWA proxying the iframe's requests over the encrypted channel**, the daemon fetching `localhost`. A service worker only intercepts requests from pages on its own origin, so the previewed app would run as the PWA's origin, where its scripts could read the PWA's storage, pairing keys included. A sandboxed iframe with an opaque origin is not controlled by the worker at all. A service worker cannot intercept WebSockets either, so hot reload breaks, and absolute URLs would need rewriting. Rejected on the first point alone.
2. **A tunnel through the relay on a per-preview subdomain**, `<hash>.<preview domain>`, the daemon holding a tunnel connection and the relay routing each subdomain's HTTP and WebSocket traffic to it. This gives the app its own origin, so hot reload, absolute paths and same-origin requests work. The costs: the relay terminates TLS and sees the preview's traffic in plaintext, an exception to ADR 0003; every relay, self-hosted ones included, needs wildcard DNS and a wildcard certificate (DNS-01); a public relay would serve anyone's pages under its domain, a phishing risk unless previews live on a separate domain and are gated by a token; and some apps still fail (a frontend calling a second local port by absolute URL, a dev server's host check, an app that forbids framing, third-party cookies in an iframe that Safari blocks), leaving "open in a new tab" as the fallback for many of them.
3. **The operator's own tunnel or network**: Tailscale (the phone on the same tailnet opens `http://<box>:<port>`, or Tailscale Serve/Funnel), a Cloudflare tunnel, ngrok and the like. These already solve the problem well, with access control the operator chooses, at no cost to Flux.

## Decision

1. **Flux does not preview localhost.** No third tab, no tunnel in the relay, no proxy in the PWA. A preview is the operator's own: their tunnel or private network, opened in the phone's browser.
2. **Nothing in Flux stands in the way of it.** An agent that starts a dev server or a tunnel can tell the operator the URL with `flux_notify` or in its reply, where the timeline renders it as a link.
3. **Reopening this needs a new ADR** that answers the costs of option 2 above, chiefly the relay seeing plaintext, rather than one of the options already weighed.

## Consequences

- The relay stays a forwarder of ciphertext, and a self-hosted relay needs no wildcard DNS or certificates.
- Seeing a running web app from the phone takes setup outside Flux, once per box. Tailscale on the box and the phone is the simplest path for a single operator.
- If option 2 is ever built, it should live on a domain apart from the PWA's, be off by default on each relay, and admit only a paired device through a short-lived token issued over the encrypted channel.
