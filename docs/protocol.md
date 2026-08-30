# Flux: protocol

Status: draft v2, 2026-08-29. Protocol version `2` (version 1 derived channel keys without the handshake transcript; see § 3 and `adr/0019`). Breaking changes bump the version; both ends refuse to talk across versions.

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

WebSocket at `wss://<relay-host>/ws/<roomId>`, derived from the relay origin the operator configured (`FLUX_RELAY_URL` on the box, the pairing link's origin on the device) by `relayEndpoint.websocket`. The transport must be TLS: a party refuses to open `ws://` (or an `http://` origin) unless the host is `localhost`, `127.0.0.1` or `::1`, with the error code `insecure_transport`, before any socket is opened. Frames are end-to-end encrypted regardless, but a plaintext path still sees room ids and both handshake hellos and can drop or replay handshakes; the loopback exception is for development, where the relay and the box are the same machine.

First message from a connecting party, plaintext JSON:

```ts
{ v: 2, role: 'host', token: string }   // box
{ v: 2, role: 'guest' }                 // device
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

Device initiates. Each side has a static keypair and generates an ephemeral X25519 keypair per connection. A connection is one handshake, not one device: every tab of a browser profile holds the same static key, so one device may have several channels open at once, each with its own keys and nonce counters. The box keeps them all and answers each on the channel its frame opened on; a data frame carries the device's fingerprint (below), not a connection id, so the box tries the device's channels and exactly one decrypts. The relay broadcasts everything the box sends, so a device also sees the box hellos and the data frames of every other connection, its own other tabs included; a frame that is not for a channel (another fingerprint, a handshake frame, or one that does not decrypt) is dropped, never a reason to reconnect. The relay does not tell the host when a guest leaves, so the box caps channels per device at the relay's guest limit and, past it, drops channels that have not yet been confirmed (step 4) first, oldest first (one under 2 s old is spared while the device has at most 8 unconfirmed, so tabs opened together can all confirm), and a confirmed channel only for a newly confirmed one, then the one it heard from least recently, so a replayed handshake under a device's key never costs it a working channel; an unconfirmed channel is dropped 30 s after its handshake in any case; a device that wants to keep a channel keeps talking on it (the PWA calls `hello` once a minute).

1. Device → box (kind `0x01`, plaintext payload `helloD`):
   `{ v: 2, devPub, devEph, nonceD }` where `nonceD` is 16 random bytes.
2. Box → device (kind `0x01`, plaintext payload `helloB`):
   `{ v: 2, boxEph, nonceB, to }` where `to` is the device's fingerprint (below), so the other guests in the room, who also receive this broadcast, can ignore it.
3. Both compute:
   ```
   ss = X25519(static_self, static_peer)
   es = X25519(eph_self,    eph_peer)
   ikm = es || ss
   salt = nonceD || nonceB
   info = "flux-v2" || SHA-256(helloD || helloB)
   keys = HKDF-SHA256(ikm, salt, info, 64 bytes)
   k_d2b = keys[0..32]    // device → box
   k_b2d = keys[32..64]   // box → device
   ```
   `info` is 39 bytes: the 7 ASCII bytes `66 6c 75 78 2d 76 32` followed by the 32-byte digest. `helloD` and `helloB` are the handshake payloads exactly as they went over the wire, the bytes after the frame kind, concatenated with nothing between them. Neither side re-serialises: the sender hashes the bytes it sent, the receiver the bytes it received, so the two sides agree only if the transcript was not touched. The whole of both hellos is thereby authenticated, including the fields the DH does not cover: `v` on both sides and `to`. Any change to either hello on the path (a downgraded `v`, a redirected `to`, so much as a byte of whitespace) yields different keys on the two sides, and the connection fails at step 4 rather than carrying on with an altered handshake. (`roomId`, which version 1 put in `info`, is a hash of `boxPub`, already bound through `ss`.)
4. Key confirmation, without an extra round trip: the device sends the first data frame, the `hello` RPC (§ 7), with nonce 0. If `devPub` is not trusted and no pairing secret is live, the box does not answer the handshake at all. A device that can decrypt the `hello` result knows the box holds `boxPriv` and derived the same transcript; a box that opens the frame knows the same of the device and marks the channel confirmed. A data frame with nonce 0 for a device's fingerprint that opens on none of that device's channels is a failed confirmation: the box drops every channel of that device still waiting for its first frame (there is at most one in the common case; with several tabs handshaking at once it cannot tell which one failed, and they all reconnect), and never keeps a channel it has not been able to decrypt. A failed frame with a later nonce drops nothing, so a corrupt or stray frame cannot cut a working channel. (Any guest in the room can send a junk nonce-0 frame under a device's fingerprint and so evict that device's unconfirmed channels, at most a handshake's worth; the same guest can already fill the room or flood handshakes, so this is accepted, `adr/0019`.) The drop is silent, so the device's side of the confirmation is the timeout: a `hello` call that goes unanswered, the first one or a later keepalive, closes the socket and the device handshakes afresh, never keeping a channel that does not decrypt. Only `hello` does this; other methods may take as long as they take. An untrusted device may only call `pair.request` until it is paired (`not_paired` otherwise). A paired device that gets `not_paired` has been revoked (§ 6) and must forget its keys.

Both guards accept any positive integer `v`, so a peer on another version still parses. A box that receives a device hello with `v ≠ 2` answers with its own hello (`v: 2`, a fresh `boxEph` and `nonceB`) but derives nothing and keeps no channel; a device that receives a box hello for its fingerprint with `v ≠ 2` stops, tells the operator which side to update (`bad_version`: "Box is on protocol 1; update it"), and retries at the full backoff in case the box is updated meanwhile. A box on version 1 does not reach this point: the relay refuses its join (§ 2), and its console says so.

Properties: mutual authentication via `ss`, forward secrecy via `es`, transcript authentication and downgrade resistance via `info`. Replay across connections is impossible because `es` and `salt` are fresh. Nonces are counters per direction starting at 0; a receiver rejects any nonce ≤ the last seen. Senders must therefore emit frames in counter order even though encryption is asynchronous (the reference implementation queues seals per channel).

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
  parent?: string; // the Agent call (`tool.start.toolId`) this event belongs to, when a subagent produced it; absent on every top-level event
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
  | Envelope<'session.cleared', Record<string, never>> // the agent's context was dropped (sessions.clear); what follows is a fresh conversation

  // conversation, normalised across agents
  | Envelope<
      'msg.user',
      {
        text: string;
        refs?: CodeRef[];
        commentIds?: string[];
        replyTo?: number;
        attachments?: Attachment[]; // files stored on the box for this message (§ 7, attach.*)
      }
    >
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
  | Envelope<
      'ask.answered',
      { askId: string; answer: string; by: 'device' | 'timeout' | 'aborted' }
    > // aborted: the agent gave up waiting (operator interrupt), answer is ''
  | Envelope<'notify', { level: 'info' | 'done' | 'blocked'; summary: string }>

  // code
  | Envelope<
      'files.changed',
      { files: { path: string; status: 'A' | 'M' | 'D' | 'R'; from?: string }[] }
    >
  | Envelope<'comment.added', { commentId: string; ref: CodeRef; text: string }>
  | Envelope<'comment.removed', { commentId: string }>
  | Envelope<'comment.sent', { commentIds: string[]; msgSeq: number }>

  // agent signals (Claude Code system lines, architecture.md § Adapter)
  | Envelope<
      'task.started',
      {
        taskId: string;
        toolUseId: string;
        description: string;
        background: boolean;
        agentType?: string; // the Agent call's `subagent_type` ('Explore', 'general-purpose', …) when the box saw it
      }
    >
  | Envelope<'task.progress', { taskId: string; description: string; tokens?: number }> // what the task is doing now, for the device's agents strip; tokens its usage so far when reported
  | Envelope<'task.ended', { taskId: string; status: string; summary: string; tokens?: number }> // status: 'completed' | 'failed' | whatever the agent adds next; summary is the subagent's final report; tokens its own usage when reported
  | Envelope<
      'pr.published',
      { provider: string; url: string; repo: string; identifier: string; action: string }
    > // action: 'created' from the agent; the box's own git.pr logs 'created' or 'existing'
  | Envelope<
      'hook.failed',
      { hookName: string; hookEvent: string; exitCode?: number; stderr: string }
    >

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
  parent?: string;
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

interface Attachment {
  id: string; // from attach.end
  name: string; // as stored on the box: [A-Za-z0-9._-] only
  mime: string;
  size: number; // bytes
  image: boolean; // the box also sent it to the agent as an image block (png, jpeg, gif or webp within 5 MiB)
}
```

Rules:

- `summary` on `tool.start` / `tool.end` is a one-line, human-readable string produced by the adapter (for example `Write src/foo.ts`, `Bash: pnpm test (exit 0)`). The PWA renders summaries and only fetches `input` / `output` on expand.
- `output` on `tool.end` is capped at 64 KiB by the adapter; longer output is truncated with a marker. Full output is available via the agent's transcript on the box if ever needed.
- `files.changed` is emitted by the daemon after any `tool.end` whose adapter flags a filesystem write, computed from `git status --porcelain` in the worktree. It reflects the full current set, not a delta.
- A `type` the receiver does not know is accepted with its payload untouched and kept in the log (§ 8).
- `msg.user.refs` are the code references rendered into the text sent to the agent. The daemon renders each ref as a fenced block with path and line range plus the referenced lines, so the agent sees the actual code.
- `msg.user.replyTo` is the `seq` of an earlier top-level `msg.user` or `msg.assistant` in the same log that this message answers. The device sends the seq, never the quote: the daemon reads the quoted text from the log (the raw message, never a rendering of it) and puts it before the message as a `>` block (capped at 20 lines and 4000 characters, `…` marking a cut) headed `In reply to your earlier message:` or `In reply to my earlier message:`, so the agent knows which message the operator means and the device can show the reply linked to its source. A `replyTo` that is not such a message in that log is `bad_params`: a seq from another session, a non-message row, or a subagent's row (`parent` set; its `msg.user` is the agent's prompt, not the operator's). The field is optional on both sides: a device that predates it never sends it and ignores it on rows, a daemon that predates it ignores the param (guards check the fields they know) and sends the message unquoted, and the row it logs carries no `replyTo`, so a newer device shows no chip rather than a wrong one.
- `msg.user.attachments` lists the files sent with the message (`adr/0020`), in the order the device named them in `agent.send`. The daemon renders each as a line `Attached: <absolute path on the box> (<mime>, <size>)` after the message and its code references, so the agent can open the file with its own tools; an `image` one is also sent to the agent as a base64 image content block. Absent when the message had none; a device that predates the field shows the text alone.
- `task.started` / `task.ended` bracket a tool call the agent runs as a task (`toolUseId` is that call's `tool.start.toolId`); `background` says the agent did not wait for it. `status` and `pr.published.action` are open sets: the receiver shows the string it gets and styles only the values it knows. `agentType` is absent when the agent did not name one; `tokens` when it reported no usage. `task.progress` rows between the two restate what the task is doing (its `description` replaces the strip's line while the task runs); a receiver may get none, one or many per task.
- `parent` is set on every event a subagent produced (its prompt as `msg.user`, its `msg.assistant`, `tool.start`, `tool.end`, `files.changed`, `hook.failed`, `raw`, …) and names the Agent call that spawned it, which is the `toolUseId` of a `task.started` in the same log. It is absent, never `null`, on top-level events, so a log without subagents is what it was before the field and a device that predates it ignores it. Nested subagents chain: a grandchild's `parent` is the child's own Agent call, so the tree is walked through `task.started` rows; the `task.*` rows themselves carry the `parent` of the agent that spawned the task (none at the top level). Task boundaries are not synthesised: a task with no `task.ended` when the session leaves `running` (its `session.state` `idle` or `ended`, or `session.cleared`) was interrupted, and the device shows it so. `ask` and `notify` are always top-level: the Flux tools reach the box over the control socket, not the agent's stream.
- `pr.published` is logged when the agent opens a pull request itself and when the operator opens one through `git.pr`, so a session's PR is always the latest `pr.published` in its log. `repo` and `identifier` are empty strings when the URL is not a GitHub pull request URL.
- `hook.failed` is logged only for a hook whose outcome is not `success`; `stderr` is capped at 2 KiB by the adapter. `exitCode` is absent when the agent did not report one.

## 6. Ephemeral messages

Never logged, may be dropped.

```ts
type Ephemeral =
  | { type: 'delta'; session: string; forSeq: number; text: string } // streaming assistant text; forSeq is the seq the final msg.assistant will take
  | { type: 'typing'; session: string; deviceId: string } // optional, P2
  | { type: 'agent.status'; session: string; status: 'thinking' | 'tool' | 'idle' }
  | { type: 'agent.thinking'; session: string; active: boolean; estimatedTokens?: number } // a thinking block is open; the count is the agent's running estimate
  | { type: 'agent.context'; session: string; tokens: number; model: string; window?: number } // context in use after a model call: the prompt size and, when the box knows it, the model's window
  | { type: 'vcs.changed'; session: string; kind: string } // the agent changed git state (kind: 'push', …); the device refetches its changes data
  | { type: 'device.revoked'; deviceId: string }; // box → the device being revoked, then the box forgets its channel
```

`agent.thinking` is sent with `active: true` when a thinking block starts, again with `estimatedTokens` as the agent reports progress (the box sends at most one report per 500 ms or per 100-token change), and with `active: false` when the block ends. The device shows the indicator while active and drops it on `active: false`, on the first streamed text, and when the session leaves `running`, since a turn that ends mid-thought never sends the stop.

`agent.context` is sent once per model call: `tokens` is the whole prompt size of that call, which is the context in use, and `model` is the model id. For Claude Code it comes from `message_start` (`input + cache_creation + cache_read`) as the response begins; for pi from the assistant `message_end` (`input + cacheRead + cacheWrite`) as it ends, since pi's per-message usage is that one call's. `window` is the model's context window when the box can name it (a hand-maintained table keyed by model-id prefix, overridable by `FLUX_CONTEXT_WINDOW`), and is omitted for an unknown model, in which case the device shows the raw token count with no percentage. `turn.ended.usage` is a per-turn sum and is not this.

`device.revoked` is the one ephemeral without a session. The box sends it on the channel of a device that has just been removed (`devices.remove`, or `flux devices rm` on the box) and then drops that channel: later frames from it are ignored, and a fresh handshake is treated as a stranger's (§ 3). A device that removed itself gets its `rpc.result` first, then the notice. On receipt the device forgets its keys and returns to pairing.

`forSeq` is the daemon's next seq for that session at the time the assistant message begins. If a tool call is logged in between (which takes that seq), the daemon sends a fresh `delta` with the corrected `forSeq` and an empty `text` to reset the client buffer. The client treats deltas as display hints only.

## 7. RPC methods

Device → box. Params are validated by type guards on the box (`rpcMethods`), results on the device (`rpcResults`); a result that fails its guard is a `bad_reply` on the device, never a trusted value.

| method               | params                                                                               | result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`              | `{ protocol: 2; client: string }`                                                    | `{ protocol: 2; daemon: string; sessions: SessionSummary[]; vapidPublicKey?: string; agents?: ('claude' \| 'pi')[]; version?: string }` (`agents`: the agent binaries the box found at start; absent means claude only. `version`: the daemon's app version, ADR 0021; absent from daemons before this shipped)                                                                                                                                                                                                                                                       |
| `events.sync`        | `{ session; since: number }`                                                         | `{ events: FluxEvent[]; complete: boolean }` (paged, 500 per call)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sessions.list`      | `{}`                                                                                 | `SessionSummary[]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sessions.cost`      | `{ session }`                                                                        | `{ costUsd: number; usage: TokenUsage; turns: number }` (aggregated from `turn.ended`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sessions.create`    | `{ repo; branch; base?: string; agent; title? }`                                     | `SessionSummary`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `sessions.archive`   | `{ session; removeWorktree?: boolean; deleteBranch?: boolean; discard?: boolean }`   | `{}` (closes the agent, marks the session archived; `removeWorktree` also `git worktree remove`s it, refused as `dirty` while it holds uncommitted files or unpushed commits unless `discard`, which forces; `deleteBranch`, only with `removeWorktree`, then `git branch -D`, `git_error` when git refuses, as for the default branch or one checked out elsewhere; a worktree already gone from disk is pruned from git instead, so its branch can still go; `bad_params` for a worktree outside the box's own worktrees directory, which the daemon never removes) |
| `sessions.unarchive` | `{ session }`                                                                        | `{}` (marks it not archived; `not_found` when its worktree is gone from the box; the next `agent.send` resumes the agent as it would after a restart)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `sessions.clear`     | `{ session }`                                                                        | `{}` (the `/clear` of a terminal session: closes the agent and forgets its session id, so the next `agent.send` starts a fresh agent context in the same worktree; every open `ask` is answered `aborted` on its connection and logged `ask.answered by: 'aborted'` before the agent goes, then `session.cleared`; pending comments survive)                                                                                                                                                                                                                          |
| `sessions.rename`    | `{ session; title }`                                                                 | `{}` (sets the session's title, the tab's label, archived or not; trimmed, `bad_params` when blank or over 200 characters; logged as `session.renamed`, which is how every device's tab learns the new name)                                                                                                                                                                                                                                                                                                                                                          |
| `sessions.restart`   | `{ session }`                                                                        | `{}` (respawns agent with resume)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `agent.send`         | `{ session; text; commentIds?: string[]; replyTo?: number; attachments?: string[] }` | `{ seq: number }` (`attachments` are ids from `attach.end`, each complete and the session's own, else `bad_params`; `too_large` when they total over 50 MiB)                                                                                                                                                                                                                                                                                                                                                                                                          |
| `agent.answer`       | `{ session; askId; answer }`                                                         | `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `agent.interrupt`    | `{ session }`                                                                        | `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `comments.add`       | `{ session; ref: CodeRef; text }`                                                    | `{ commentId }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `comments.remove`    | `{ session; commentId }`                                                             | `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `git.status`         | `{ session }`                                                                        | `{ files: FileStatus[] }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `git.diff`           | `{ session; path?: string; from?: string; to?: string }`                             | `{ diff: string }` (unified, `from` defaults to `base`, `to` defaults to `worktree`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `git.show`           | `{ session; path; rev }`                                                             | `FileContent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `git.log`            | `{ session; limit? }`                                                                | `{ commits: Commit[] }` (the commits the session added on top of its base, newest first, `limit` default 50; the base's own history is not listed, so a session that has not committed yet gets `[]`)                                                                                                                                                                                                                                                                                                                                                                 |
| `git.commit`         | `{ session; message; paths?: string[] }`                                             | `{ sha }` (stages and commits `paths` only, or all changes incl. untracked; `bad_params` on an empty message, an empty list, `''`/`.` or a path outside the worktree; a renamed file needs both its paths)                                                                                                                                                                                                                                                                                                                                                            |
| `git.push`           | `{ session; setUpstream?: boolean }`                                                 | `{ remote; branch }` (never forces; a branch's first push sets its upstream; `git_error` when detached, without a remote, or rejected by the remote)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `git.pr`             | `{ session; title; body?; base?; draft?: boolean }`                                  | `{ url }` (`gh pr create` in the worktree; the branch's _open_ PR is returned instead if there is one, a closed or merged one is not; `base` defaults to the session's base when that is a branch of the repository, otherwise to gh's choice, the repository's default branch)                                                                                                                                                                                                                                                                                       |
| `fs.read`            | `{ session; path }`                                                                  | `FileContent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `fs.write`           | `{ session; path; content: string; ifMatch?: string }`                               | `{ hash: string }` (P2; atomic, UTF-8, inside the worktree only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `fs.list`            | `{ session; path }`                                                                  | `{ entries: { name; kind: 'file' \| 'dir' }[] }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `repos.list`         | `{}`                                                                                 | `{ repos: { path; name; branches: string[] }[] }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pair.request`       | `{ devPub; proof }`                                                                  | `{ deviceId }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `push.subscribe`     | `{ subscription: PushSubscriptionJSON }`                                             | `{}` (stored on the box, which sends pushes itself, `adr/0013`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `devices.list`       | `{}`                                                                                 | `Device[]` (`current` marks the caller)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `devices.remove`     | `{ deviceId }`                                                                       | `{}` (`not_found` if unknown; the device is told and cut off, § 6; self-removal allowed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `settings.get`       | `{}`                                                                                 | `Settings`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `settings.set`       | `{ flux?: Partial<FluxSettings>; agent?: Partial<AgentConfig> }`                     | `Settings` (the whole state after the patch; `bad_params` and nothing written if any part is invalid, including an unknown key; `agent_unavailable` when `flux.defaultAgent` names an agent the box did not find, see `hello.agents`)                                                                                                                                                                                                                                                                                                                                 |
| `attach.begin`       | `{ session; name; mime; size: number }`                                              | `{ attachmentId }` (`too_large` over 20 MiB; `not_found` for an unknown session)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `attach.chunk`       | `{ attachmentId; index: number; data: string }`                                      | `{}` (`data` is standard base64 of at most 512 KiB raw; `index` runs from 0 in order; out of order, repeated, oversized or past the declared size is `bad_params`)                                                                                                                                                                                                                                                                                                                                                                                                    |
| `attach.end`         | `{ attachmentId; hash }`                                                             | `{ path; size }` (`hash` is the sha256 hex of the whole file; a mismatch or fewer bytes than declared is `bad_params` and the partial file is deleted; `path` is where the box put it)                                                                                                                                                                                                                                                                                                                                                                                |
| `attach.read`        | `{ attachmentId; offset: number; length: number }`                                   | `{ data; size; mime; name }` (a slice of a complete attachment, `length` at most 512 KiB, `bad_params` past that; `data` is standard base64, shorter than asked at the end of the file)                                                                                                                                                                                                                                                                                                                                                                               |
| `attach.delete`      | `{ attachmentId }`                                                                   | `{}` (removes the file and its row, an unfinished upload included; `not_found` if unknown)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

```ts
interface SessionSummary {
  session: string;
  title: string;
  repo: string;
  branch: string;
  agent: 'claude' | 'pi';
  state: 'idle' | 'running' | 'waiting_user' | 'ended';
  lastSeq: number;
  createdAt?: string; // when the session was created; the device orders tabs by it, never by activity. Absent from a daemon built before 2026-08-29; the device then orders by id
  updatedAt: string;
  archived?: boolean; // hidden from the tab strip, listed under Archived; `sessions.list` and `hello` carry archived sessions too
  worktreeExists?: boolean; // false once the worktree is gone from the box (removed on archive, or by hand): such a session cannot be reopened. Both absent from a daemon built before 2026-08-29, which listed live sessions only
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
  defaultAgent: 'claude' | 'pi'; // must be in hello.agents; settings.set answers agent_unavailable otherwise
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

Attachments (`adr/0020`): a file the operator attaches to a message goes over the channel in chunks, since every frame is capped at 1 MiB (§ 2) and the relay must stay ignorant. The device calls `attach.begin`, then `attach.chunk` for each 512 KiB of the file in order, then `attach.end` with the file's sha256, and names the id in `agent.send.attachments`; the box stores the bytes under `<dataDir>/attachments/<session>/<id>-<name>` (the name reduced to `[A-Za-z0-9._-]`, never inside a worktree) and lists them on the logged `msg.user`. Caps: 20 MiB per file, 50 MiB per message, 512 KiB raw per chunk and per `attach.read`. An upload with no `attach.end` within 10 minutes (the channel went away, say) and a complete attachment never named in an `agent.send` within 24 hours are deleted lazily, at daemon start and before the next `attach.begin`. A sent attachment stays until the session is deleted (`sessions.archive` with `removeWorktree`); a plain archive keeps it, so a reopened session can still show it. `attach.read` is for the device to show a sent image again (thumbnails); it pages through the file 512 KiB at a time.

`fs.write` writes `content` as UTF-8 to a temp file in the same directory, gives it the existing file's mode, and renames it over the file, so a reader never sees a half-written file. Every path a device names for `fs.read`, `fs.write`, `fs.list` or `git.show` at `worktree` must resolve, symlinks included, to somewhere under the session's worktree (`bad_params` otherwise; absolute paths and `..` are refused before touching the disk); a symlink that stays inside is read and written through, so the link survives. A path with a `.git` segment at any depth, in any letter case, before or after symlink resolution, is `bad_params`: editing the repository's own metadata (a submodule's included) can break the worktree or run code on the box. A path through a file or over a directory is `bad_params`; a missing directory, or a missing file when `ifMatch` is given, is `not_found`. With `ifMatch`, the write only happens when the file's current hash equals it; otherwise `conflict` and nothing changes, which is how two editors of one file find out about each other. Writes to one file are serialised on the box, so two devices saving with the same `ifMatch` get exactly one success; an agent writing the same file through its own tools is not in that queue, so device-versus-agent detection is best effort (an agent write between the check and the rename is lost). Without `ifMatch` the write is unconditional. The result's `hash` is the hash of what was written, for the next `ifMatch`.

Error codes: `bad_params`, `not_found`, `not_paired`, `agent_unavailable`, `git_error`, `gh_error`, `conflict`, `dirty`, `too_large`, `internal`. `too_large` is returned by `attach.begin` for a file over 20 MiB and by `agent.send` for attachments totalling over 50 MiB. `conflict` is returned by `fs.write` when `ifMatch` does not match the current file. `dirty` is returned by `sessions.archive` with `removeWorktree` when the worktree holds uncommitted files or unpushed commits (no upstream: commits since the session's base) and `discard` is not set; the message says how many of each, for the device to show before asking again with `discard`.

`git_error` and `gh_error` carry the tool's own stderr (or stdout when stderr is empty, as for "nothing to commit") as the message, so the device shows what git or gh said. `gh_error` also covers `gh` missing from the box's PATH, with the message `gh not found on PATH`. Git actions emit no events, except that `git.pr` logs `pr.published` (§ 5) so the session's PR has one source; the device refreshes `git.status` and `git.log` after each one (`adr/0014`).

## 8. Versioning

`protocol: 2` is exchanged in `hello`, in both handshake hellos (`v`) and in the relay's first message. Additive changes (new event types, new optional fields, new RPC methods) do not bump the version. Removing or changing the meaning of anything bumps the version.

The app version (semver) is a separate thing, exchanged in the `hello` RPC result as `version` (§ 7, ADR 0021), never in the handshake hellos (those bytes are bound into key derivation, § 3). It is distinct from `protocol`: it moves every release, while `protocol` only changes on a breaking wire change. Being optional, adding it is additive and does not bump `protocol` — a daemon built before it shipped simply omits it, and the device feature-detects rather than assuming it is present. Version 2 (2026-08-29) changed key derivation to bind the handshake transcript (§ 3, `adr/0019`), so version 1 and 2 peers derive different keys: the relay refuses a version 1 join with `bad_version`, a box answers a version 1 device hello with its own version and no channel, and a device shown a box hello with another version reports `bad_version` rather than waiting on a channel that cannot decrypt.

Unknown event types are version skew, not corruption. A receiver accepts any envelope whose `type` is a string it does not know, with whatever `payload` it carries, both as a live `event` message and inside an `events.sync` page; dropping it would leave a gap in `seq` and force a sync that can never complete. The event is kept in the log and rendered like `raw`: the type name and the payload as opaque JSON. A known type whose payload fails its guard is still rejected.
