# 0009: Hand-written type guards instead of a schema library

Status: accepted, 2026-08-28.

## Context

Every message crossing the wire must be validated. Zod, Valibot and TypeBox are the usual answers. The protocol has roughly 20 event types and 20 RPC methods with small, flat payloads.

## Decision

Hand-written `isX(value: unknown): value is X` guards in `packages/protocol`, with a handful of tiny combinators (`isString`, `isRecord`, `hasKeys`, `isOneOf`). 100% test coverage on that package.

## Consequences

- Zero runtime dependencies in `packages/protocol`.
- Adding a field means editing a type and a guard and a test. That friction is intentional: it keeps the protocol small.
- Revisit if the protocol exceeds ~60 shapes or gains nested structures that make guards error-prone.
