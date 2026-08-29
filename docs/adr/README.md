# Architecture decision records

One file per decision. Numbered, never deleted. To change a decision, write a new ADR that supersedes the old one and mark the old one `Superseded by NNNN`.

Format: Context, Decision, Consequences. Keep each under a page.

| #    | title                                                                  | status   |
| ---- | ---------------------------------------------------------------------- | -------- |
| 0001 | Monorepo with pnpm workspaces and Vite+                                | accepted |
| 0002 | Node 24 as the only server runtime                                     | accepted |
| 0003 | Dumb relay with end-to-end encryption, box as sole source of truth     | accepted |
| 0004 | Vue 3 for the PWA                                                      | accepted |
| 0005 | CodeMirror 6, not Monaco                                               | accepted |
| 0006 | Event log in node:sqlite, gapless per-session seq                      | accepted |
| 0007 | Claude Code adapter: read from transcripts, write via swappable input  | accepted |
| 0008 | Flux-owned MCP tools for ask and notify                                | accepted |
| 0009 | Hand-written type guards instead of a schema library                   | accepted |
| 0010 | Dependency ledger                                                      | living   |
| 0011 | Hono for the relay HTTP layer                                          | accepted |
| 0012 | Pairing via QR in URL fragment, X25519 static keys, one-time secret    | accepted |
| 0013 | The daemon sends Web Push itself; the relay holds no subscriptions     | accepted |
| 0014 | Git actions from the PWA spawn `git` and `gh`, emit no events          | accepted |
| 0015 | Settings on the box, agent config as raw files, revocation as a notice | accepted |
