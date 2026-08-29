# Flux

Agents get their own computer; the operator steers and reviews them from a phone or laptop. Three apps (`daemon` on the box, `relay` on a VPS, `pwa` as the remote) and one shared `protocol` package.

Read in this order before changing anything:

1. `docs/engineering.md`: the rules. Toolchain, TypeScript settings, style, testing, the dependency policy, definition of done.
2. `docs/architecture.md`: what each part does and how they connect.
3. `docs/protocol.md`: the wire contract. `packages/protocol` is its implementation.
4. `docs/adr/`: why things are the way they are. Do not re-open a decision without a new ADR.
5. `docs/prd.md`: what we are building and what we are not.

Hard rules, repeated here because they are the ones most often broken:

- No new dependency without following `engineering.md` § Dependencies. If in doubt, stop and ask.
- Never weaken lint, format or tsconfig to make something pass.
- `vp check` must pass before every commit. The hook enforces it; do not bypass it.
- Protocol changes go in `packages/protocol` first, then both ends, in one commit, with `docs/protocol.md` updated.
- Fixtures are captured from real agent output, never hand-edited.
