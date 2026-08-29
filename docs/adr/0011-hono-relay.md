# 0011: Hono for the relay HTTP layer

Status: accepted, 2026-08-28.

## Context

The relay serves static files (the PWA), handles a WebSocket upgrade route, and two small authenticated POST endpoints for Web Push. Candidates: raw `node:http`, Hono, Express, Fastify.

## Decision

Hono with `@hono/node-server`. It is built on web-standard `Request`/`Response`, small, typed, and the same code would run on other runtimes if 0002 is ever revisited. Express and Fastify carry more weight and older abstractions for no gain here.

Raw `node:http` was seriously considered given the dependency policy. Rejected because correct static file serving (ETags, ranges, caching headers, path traversal safety) is where bugs live, and Hono's `serveStatic` is well-trodden.

## Consequences

- `hono` and `@hono/node-server` in the ledger.
- WebSocket handling uses `ws` attached to the Node server; Hono handles everything else.
