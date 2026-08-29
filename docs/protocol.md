# Flux: protocol

Status: draft v1, 2026-08-28. Protocol version `1`. Breaking changes bump the version; both ends refuse to talk across versions.

All types here are the contract implemented in `packages/protocol`. That package contains the TypeScript types, hand-written type guards (no schema library, see `adr/0009`), binary framing, and crypto helpers. All three apps import from it and nothing else defines wire shapes.

## 1. Identity and pairing

### Keys

- Box: static X25519 keypair, generated on first `flux daemon` run, stored in the daemon's SQLite. `boxPub` is 32 bytes.
- Device: static X25519 keypair, generated on first PWA run, stored in IndexedDB. `devPub` is 32 bytes.
- Room id: `base64url(sha256(boxPub))[0..22]`. Derivable by anyone who knows `boxPub`, meaningless to anyone else.
- Room token: `base64url(HMAC-SHA256(key = sha256("flux-room" || boxPub), msg = roomId))`. Presented to the relay to join as `host`. Guests need no token; possessing the room id is enough to _connect_, and connecting yields nothing without the keys. Rationale: keeps the relay ignorant while stopping a stranger from squatting the host slot.

### Pairing URL

```
https://<relay-host>/#<base64url(boxPub)>.<base64url(secret)>
```

- `secret` is 16 random bytes, single use, expires 10 minutes after `flux pair` prints it.
- The payload is in the URL fragment so it never reaches the relay's HTTP logs.
- Opening the URL loads the PWA, which reads and clears the fragment, then starts pairing.

### Pairing handshake

Runs inside a normal connection handshake (section 3) but with `devPub` not yet trusted by the box.

1. Device connects to room as guest, completes the encrypted handshake using its static key. The box does not yet know `devPub`, so it accepts the handshake provisionally.
2. Device sends `pair.request { devPub, proof }` where `proof = HMAC-SHA256(secret, devPub || boxPub)`.
3. Box checks `secret` is live, verifies `proof`, stores `devPub` with a generated device id and name, burns the secret, replies `pair.ok { deviceId }`.
4. Any failure: `pair.fail` and the box closes the connection. Three failures burn the secret.

Subsequent connections skip this; the handshake alone authenticates a trusted `devPub`.

## 2. Relay

WebSocket at `wss://<relay-host>/ws/<roomId>`.

First message from a connecting party, plaintext JSON:

```ts
{ v: 1, role: 'host', token: string }   // box
{ v: 1, role: 'guest' }                 // device
```

Relay replies `{ ok: true }` or `{ ok: false, error: 'bad_version' | 'bad_token' | 'host_present' | 'room_full' }` and closes on error.

After that, all messages are binary and opaque to the relay:

- Host → relay: broadcast to all guests.
- Guest → relay: forwarded to host. If no host is present, the relay sends the guest `{ type: 'no_host' }` (plaintext JSON control frame) and drops the message.
- Relay → all: `{ type: 'host_joined' }` / `{ type: 'host_left' }` plaintext control frames so guests can show connection state without waiting for a timeout.

Limits (initial, hard-coded): frame ≤ 1 MiB, guests per room ≤ 8, connections per IP per minute ≤ 30. The IP is the socket's peer address, or the last hop of `X-Forwarded-For` when the relay runs with `FLUX_TRUST_PROXY=1` behind a reverse proxy (never inferred). Counters only; no address is logged.

Room tokens: the relay cannot derive a token (it never sees `boxPub`), so the first host to claim a room registers its token and later claims must present the same one. Tokens are kept in memory for the relay's lifetime, so a squatter cannot take the host slot while the real box is reconnecting.

Web Push is sent by the box directly to the push services; the relay has no push routes and holds no subscriptions (`adr/0013`).

## 3. Encrypted channel

Between box and one device, over the relay. Noise-inspired, not Noise-compliant; kept small because WebCrypto gives us X25519, HKDF and AES-GCM and nothing else without a dependency.

Binary frame layout (after handshake):

```
byte 0        : frame kind   0x01 handshake, 0x02 data, 0x03 data-compressed
bytes 1..12   : nonce (96-bit, per-direction counter, big-endian, never reused)
bytes 13..    : AES-256-GCM ciphertext + 16-byte tag
```

### Handshake

Device initiates. Each side has a static keypair and generates an ephemeral X25519 keypair per connection.

1. Device → box (kind `0x01`, plaintext payload):
   `{ v: 1, devPub, devEph, nonceD }` where `nonceD` is 16 random bytes.
2. Box → device (kind `0x01`, plaintext payload):
   `{ v: 1, boxEph, nonceB, to }` where `to` is the device's fingerprint (below), so the other guests in the room, who also receive this broadcast, can ignore it.
3. Both compute:
   ```
   ss = X25519(static_self, static_peer)
   es = X25519(eph_self,    eph_peer)
   ikm = es || ss
   salt = nonceD || nonceB
   keys = HKDF-SHA256(ikm, salt, info = "flux-v1-" || roomId, 64 bytes)
   k_d2b = keys[0..32]    // device → box
   k_b2d = keys[32..64]   // box → device
   ```
4. The device sends the first data frame: the `hello` RPC (§ 7). If `devPub` is not trusted and no pairing secret is live, the box does not answer the handshake at all. A device that can decrypt the `hello` result knows the box holds `boxPriv`; a box that receives a validly encrypted frame knows the device holds `devPriv`. An untrusted device may only call `pair.request` until it is paired (`not_paired` otherwise). A paired device that gets `not_paired` has been revoked (§ 6) and must forget its keys.

Properties: mutual authentication via `ss`, forward secrecy via `es`. Replay across connections is impossible because `es` and `salt` are fresh. Nonces are counters per direction starting at 0; a receiver rejects any nonce ≤ the last seen. Senders must therefore emit frames in counter order even though encryption is asynchronous (the reference implementation queues seals per channel).

Because the box broadcasts to all guests via the relay, each data frame carries the device's `devPub` fingerprint (first 8 bytes of `sha256(devPub)`) in the plaintext associated data so a guest can discard frames not meant for it without attempting decryption. Concretely: AAD = `kind || fingerprint`, and the fingerprint is prepended to the frame on the wire between `kind` and `nonce`. Final layout:

```
kind(1) | fingerprint(8) | nonce(12) | ciphertext+tag
```

### Compression

Kind `0x03` is a data frame whose plaintext was compressed with raw deflate (`CompressionStream('deflate-raw')`, available in Node 24 and browsers) _before_ encryption. The sender uses it for any payload over 1 KiB; the receiver must accept both kinds regardless of size. Ciphertext cannot be compressed, so this is the only place compression can happen; it matters for diffs and file contents (typically 5 to 10x smaller) and is skipped for small frames where the header overhead would exceed the saving.

Known trade: compress-then-encrypt reveals compressed length, which is exploitable (CRIME/BREACH) when attacker-controlled text shares a frame with a secret. Flux frames carry no secrets, so the leak is bounded to "roughly how large is this diff". Accepted.

## 4. Messages inside the channel

Decrypted payloads are UTF-8 JSON. Three message families, discriminated by top-level `kind`:

```ts
type Wire =
  | { kind: 'event'; event: FluxEvent } // box → device, logged, replayable
  | { kind: 'ephemeral'; data: Ephemeral } // either direction, never logged
  | { kind: 'rpc'; id: string; method: string; params: unknown } // device → box
  | { kind: 'rpc.result'; id: string; ok: true; result: unknown } // box → device
  | { kind: 'rpc.result'; id: string; ok: false; error: RpcError };
```

```ts
interface RpcError {
  code: string;
  message: string;
  data?: unknown;
}
```

## 5. Event log

One log per session. `seq` is per session, starts at 1, gapless. Events are immutable once appended.

```ts
interface Envelope<T extends string, P> {
  seq: number;
  ts: string; // ISO 8601, box clock
  session: string; // flux session id (ulid)
  type: T;
  payload: P;
}

type FluxEvent =
  // lifecycle
  | Envelope<
      'session.created',
      {
        repo: string; // absolute path on box
        worktree: string; // absolute path on box
        branch: string;
        base: string; // commit the branch was created from; diffs default to this
        agent: 'claude' | 'pi';
        agentSessionId?: string; // agent-native id, for resume
        title?: string;
      }
    >
  | Envelope<
      'session.state',
      {
        state: 'idle' | 'running' | 'waiting_user' | 'ended';
        reason?: string;
      }
    >
  | Envelope<'session.renamed', { title: string }>

  // conversation, normalised across agents
  | Envelope<'msg.user', { text: string; refs?: CodeRef[]; commentIds?: string[] }>
  | Envelope<'msg.assistant', { text: string }>
  | Envelope<'tool.start', { toolId: string; name: string; input: unknown; summary: string }>
  | Envelope<'tool.end', { toolId: string; ok: boolean; summary: string; output?: unknown }>
  | Envelope<
      'turn.ended',
      {
        costUsd?: number;
        durationMs?: number;
        numTurns?: number;
        stopReason?: string;
        usage?: TokenUsage;
      }
    >
  | Envelope<'rate_limit', { windows: RateWindow[] }> // emitted when the agent reports a change

  // operator interaction, owned by flux tools
  | Envelope<'ask', { askId: string; question: string; options?: string[]; timeoutAt: string }>
  | Envelope<'ask.answered', { askId: string; answer: string; by: 'device' | 'timeout' }>
  | Envelope<'notify', { level: 'info' | 'done' | 'blocked'; summary: string }>

  // code
  | Envelope<
      'files.changed',
      { files: { path: string; status: 'A' | 'M' | 'D' | 'R'; from?: string }[] }
    >
  | Envelope<'comment.added', { commentId: string; ref: CodeRef; text: string }>
  | Envelope<'comment.removed', { commentId: string }>
  | Envelope<'comment.sent', { commentIds: string[]; msgSeq: number }>

  // escape hatch
  | Envelope<'raw', { agent: string; data: unknown }>

  // any type added after this build shipped (§ 8); payload is opaque
  | UnknownEvent;

interface UnknownEvent {
  seq: number;
  ts: string;
  session: string;
  type: string; // none of the types above
  payload: unknown;
}

interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
interface RateWindow {
  name: string;
  utilisation: number;
  resetsAt: string;
} // utilisation 0..1

interface CodeRef {
  path: string; // relative to worktree
  rev: string; // commit sha, or 'worktree' for uncommitted state
  range?: { startLine: number; endLine: number }; // 1-based, inclusive
}
```

Rules:

- `summary` on `tool.start` / `tool.end` is a one-line, human-readable string produced by the adapter (for example `Write src/foo.ts`, `Bash: pnpm test (exit 0)`). The PWA renders summaries and only fetches `input` / `output` on expand.
- `output` on `tool.end` is capped at 64 KiB by the adapter; longer output is truncated with a marker. Full output is available via the agent's transcript on the box if ever needed.
- `files.changed` is emitted by the daemon after any `tool.end` whose adapter flags a filesystem write, computed from `git status --porcelain` in the worktree. It reflects the full current set, not a delta.
- A `type` the receiver does not know is accepted with its payload untouched and kept in the log (§ 8).
- `msg.user.refs` are the code references rendered into the text sent to the agent. The daemon renders each ref as a fenced block with path and line range plus the referenced lines, so the agent sees the actual code.

## 6. Ephemeral messages

Never logged, may be dropped.

```ts
type Ephemeral =
  | { type: 'delta'; session: string; forSeq: number; text: string } // streaming assistant text; forSeq is the seq the final msg.assistant will take
  | { type: 'typing'; session: string; deviceId: string } // optional, P2
  | { type: 'agent.status'; session: string; status: 'thinking' | 'tool' | 'idle' }
  | { type: 'device.revoked'; deviceId: string }; // box → the device being revoked, then the box forgets its channel
```

`device.revoked` is the one ephemeral without a session. The box sends it on the channel of a device that has just been removed (`devices.remove`, or `flux devices rm` on the box) and then drops that channel: later frames from it are ignored, and a fresh handshake is treated as a stranger's (§ 3). A device that removed itself gets its `rpc.result` first, then the notice. On receipt the device forgets its keys and returns to pairing.

`forSeq` is the daemon's next seq for that session at the time the assistant message begins. If a tool call is logged in between (which takes that seq), the daemon sends a fresh `delta` with the corrected `forSeq` and an empty `text` to reset the client buffer. The client treats deltas as display hints only.

## 7. RPC methods

Device → box. Params are validated by type guards on the box (`rpcMethods`), results on the device (`rpcResults`); a result that fails its guard is a `bad_reply` on the device, never a trusted value.

| method             | params                                                           | result                                                                                                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`            | `{ protocol: 1; client: string }`                                | `{ protocol: 1; daemon: string; sessions: SessionSummary[]; vapidPublicKey?: string }`                                                                                                                                                                                          |
| `events.sync`      | `{ session; since: number }`                                     | `{ events: FluxEvent[]; complete: boolean }` (paged, 500 per call)                                                                                                                                                                                                              |
| `sessions.list`    | `{}`                                                             | `SessionSummary[]`                                                                                                                                                                                                                                                              |
| `sessions.cost`    | `{ session }`                                                    | `{ costUsd: number; usage: TokenUsage; turns: number }` (aggregated from `turn.ended`)                                                                                                                                                                                          |
| `sessions.create`  | `{ repo; branch; base?: string; agent; title? }`                 | `SessionSummary`                                                                                                                                                                                                                                                                |
| `sessions.archive` | `{ session }`                                                    | `{}`                                                                                                                                                                                                                                                                            |
| `sessions.restart` | `{ session }`                                                    | `{}` (respawns agent with resume)                                                                                                                                                                                                                                               |
| `agent.send`       | `{ session; text; commentIds?: string[] }`                       | `{ seq: number }`                                                                                                                                                                                                                                                               |
| `agent.answer`     | `{ session; askId; answer }`                                     | `{}`                                                                                                                                                                                                                                                                            |
| `agent.interrupt`  | `{ session }`                                                    | `{}`                                                                                                                                                                                                                                                                            |
| `comments.add`     | `{ session; ref: CodeRef; text }`                                | `{ commentId }`                                                                                                                                                                                                                                                                 |
| `comments.remove`  | `{ session; commentId }`                                         | `{}`                                                                                                                                                                                                                                                                            |
| `git.status`       | `{ session }`                                                    | `{ files: FileStatus[] }`                                                                                                                                                                                                                                                       |
| `git.diff`         | `{ session; path?: string; from?: string; to?: string }`         | `{ diff: string }` (unified, `from` defaults to `base`, `to` defaults to `worktree`)                                                                                                                                                                                            |
| `git.show`         | `{ session; path; rev }`                                         | `FileContent`                                                                                                                                                                                                                                                                   |
| `git.log`          | `{ session; limit? }`                                            | `{ commits: Commit[] }`                                                                                                                                                                                                                                                         |
| `git.commit`       | `{ session; message; paths?: string[] }`                         | `{ sha }` (stages and commits `paths` only, or all changes incl. untracked; `bad_params` on an empty message, an empty list, `''`/`.` or a path outside the worktree; a renamed file needs both its paths)                                                                      |
| `git.push`         | `{ session; setUpstream?: boolean }`                             | `{ remote; branch }` (never forces; a branch's first push sets its upstream; `git_error` when detached, without a remote, or rejected by the remote)                                                                                                                            |
| `git.pr`           | `{ session; title; body?; base?; draft?: boolean }`              | `{ url }` (`gh pr create` in the worktree; the branch's _open_ PR is returned instead if there is one, a closed or merged one is not; `base` defaults to the session's base when that is a branch of the repository, otherwise to gh's choice, the repository's default branch) |
| `fs.read`          | `{ session; path }`                                              | `FileContent`                                                                                                                                                                                                                                                                   |
| `fs.write`         | `{ session; path; content: string; ifMatch?: string }`           | `{ hash: string }` (P2; atomic, UTF-8, inside the worktree only)                                                                                                                                                                                                                |
| `fs.list`          | `{ session; path }`                                              | `{ entries: { name; kind: 'file' \| 'dir' }[] }`                                                                                                                                                                                                                                |
| `repos.list`       | `{}`                                                             | `{ repos: { path; name; branches: string[] }[] }`                                                                                                                                                                                                                               |
| `pair.request`     | `{ devPub; proof }`                                              | `{ deviceId }`                                                                                                                                                                                                                                                                  |
| `push.subscribe`   | `{ subscription: PushSubscriptionJSON }`                         | `{}` (stored on the box, which sends pushes itself, `adr/0013`)                                                                                                                                                                                                                 |
| `devices.list`     | `{}`                                                             | `Device[]` (`current` marks the caller)                                                                                                                                                                                                                                         |
| `devices.remove`   | `{ deviceId }`                                                   | `{}` (`not_found` if unknown; the device is told and cut off, § 6; self-removal allowed)                                                                                                                                                                                        |
| `settings.get`     | `{}`                                                             | `Settings`                                                                                                                                                                                                                                                                      |
| `settings.set`     | `{ flux?: Partial<FluxSettings>; agent?: Partial<AgentConfig> }` | `Settings` (the whole state after the patch; `bad_params` and nothing written if any part is invalid, including an unknown key)                                                                                                                                                 |

```ts
interface SessionSummary {
  session: string;
  title: string;
  repo: string;
  branch: string;
  agent: 'claude' | 'pi';
  state: 'idle' | 'running' | 'waiting_user' | 'ended';
  lastSeq: number;
  updatedAt: string;
}

interface Device {
  deviceId: string;
  name?: string;
  pairedAt: string;
  lastSeenAt?: string; // set on each hello
  current: boolean; // the device making the call
}

interface Settings {
  flux: FluxSettings; // runtime settings, stored on the box, changeable while it runs
  env: EnvSettings; // set only by the daemon's environment; read-only here
  agent: AgentConfig;
}

interface FluxSettings {
  reposDir: string; // absolute; where `repos.list` and `sessions.create` look
  defaultAgent: 'claude' | 'pi';
  notifyOnAsk: boolean; // push on `ask`
  notifyOnIdle: boolean; // push on running → idle
  notifyOnDone: boolean; // push on `notify` done | blocked
}

interface EnvSettings {
  relayUrl: string;
  dataDir: string;
  daemonName: string;
  pushSubject: string;
  claudeCommand: string;
}

// The agent's global config files on the box, verbatim: ~/.claude/CLAUDE.md and
// ~/.claude/settings.json of the user the daemon runs as. Empty string when a file is absent.
// `settingsJson` must be a JSON object on `settings.set`.
interface AgentConfig {
  claudeMd: string;
  settingsJson: string;
}
```

```ts
interface FileContent {
  content: string; // UTF-8 text, or base64 when `binary`
  binary: boolean;
  hash?: string; // sha256 hex of the whole file's bytes
  truncated?: boolean; // `content` is only the first 1 MiB; the file must not be written back
}
```

`git.show` and `fs.read` cap `content` at 1 MiB and set `truncated` instead of sending the rest; `hash` still covers the whole file. `binary` is set for anything that is not valid UTF-8 (a NUL in the first 8 KiB, or a decode failure), because a lossy decode would be written back as different bytes under the same hash; such a file cannot be edited.

`fs.write` writes `content` as UTF-8 to a temp file in the same directory, gives it the existing file's mode, and renames it over the file, so a reader never sees a half-written file. Every path a device names for `fs.read`, `fs.write`, `fs.list` or `git.show` at `worktree` must resolve, symlinks included, to somewhere under the session's worktree (`bad_params` otherwise; absolute paths and `..` are refused before touching the disk); a symlink that stays inside is read and written through, so the link survives. A path with a `.git` segment at any depth, in any letter case, before or after symlink resolution, is `bad_params`: editing the repository's own metadata (a submodule's included) can break the worktree or run code on the box. A path through a file or over a directory is `bad_params`; a missing directory, or a missing file when `ifMatch` is given, is `not_found`. With `ifMatch`, the write only happens when the file's current hash equals it; otherwise `conflict` and nothing changes, which is how two editors of one file find out about each other. Writes to one file are serialised on the box, so two devices saving with the same `ifMatch` get exactly one success; an agent writing the same file through its own tools is not in that queue, so device-versus-agent detection is best effort (an agent write between the check and the rename is lost). Without `ifMatch` the write is unconditional. The result's `hash` is the hash of what was written, for the next `ifMatch`.

Error codes: `bad_params`, `not_found`, `not_paired`, `agent_unavailable`, `git_error`, `gh_error`, `conflict`, `internal`. `conflict` is returned by `fs.write` when `ifMatch` does not match the current file.

`git_error` and `gh_error` carry the tool's own stderr (or stdout when stderr is empty, as for "nothing to commit") as the message, so the device shows what git or gh said. `gh_error` also covers `gh` missing from the box's PATH, with the message `gh not found on PATH`. Git actions emit no events: the device refreshes `git.status` and `git.log` after each one (`adr/0014`).

## 8. Versioning

`protocol: 1` is exchanged in `hello` and in the relay's first message. Additive changes (new event types, new optional fields, new RPC methods) do not bump the version. Removing or changing the meaning of anything bumps the version.

Unknown event types are version skew, not corruption. A receiver accepts any envelope whose `type` is a string it does not know, with whatever `payload` it carries, both as a live `event` message and inside an `events.sync` page; dropping it would leave a gap in `seq` and force a sync that can never complete. The event is kept in the log and rendered like `raw`: the type name and the payload as opaque JSON. A known type whose payload fails its guard is still rejected.
