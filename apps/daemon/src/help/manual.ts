// The built-in, operator-facing flux manual, distilled from docs/ into plain answers a person on a
// phone can read. It is BUNDLED INTO THE BINARY (like trusted-keys.ts): docs/ does not ship, so the
// help surfaces — `flux help`, the `flux_help` MCP tool, and the seeded Help Agent — read this
// module, never disk. Keep it lean (a few KB): one section per topic, each short and answer-shaped.
// This is the single knowledge source; the CLI, the tool and the Help Agent all look it up.

export interface ManualSection {
  title: string;
  // Extra terms that should match this section but do not appear in its title, for the lookup
  // scorer (help-lookup.ts). Case does not matter.
  keywords?: string[];
  body: string;
}

export const manual: ManualSection[] = [
  {
    title: 'Overview',
    keywords: ['about', 'what', 'intro', 'flux', 'summary'],
    body: [
      'Flux gives a coding agent its own computer (the "box") and lets you steer and review it from',
      'a phone or laptop. Three parts talk to each other: the daemon runs on the box beside the',
      'agent, a relay on a VPS forwards traffic and serves the web app, and the PWA is your remote.',
      'You pair a device once, then create sessions — each an agent working in its own git worktree —',
      'and watch the chat, approve decisions, review diffs and open pull requests, all from the app.',
      'The box is fully trusted and runs agents with permissions bypassed; the relay only sees',
      'encrypted frames, never your code or keys.',
    ].join(' '),
  },
  {
    title: 'Pairing a device',
    keywords: ['pair', 'connect', 'qr', 'device', 'scan', 'link', 'setup'],
    body: [
      'Run `flux pair` on the box (or start `flux daemon` at a terminal): it prints a QR code and a',
      'one-time URL above it. In the web app, tap Pair and either scan the QR with the camera or',
      'paste the link. The pairing window is open for 10 minutes; mint a fresh one with `flux pair`',
      'if it lapses. Any number of devices can pair. Each paired device is trusted until you revoke',
      'it — from another device in Settings, or with `flux devices rm <id>` on the box — which cuts',
      'it off at once. The relay never sees the pairing secret; possession of the QR is the proof.',
    ].join(' '),
  },
  {
    title: 'Sessions',
    keywords: [
      'session',
      'create',
      'archive',
      'clear',
      'restart',
      'worktree',
      'branch',
      'tab',
      'delete',
      'unarchive',
      'reopen',
    ],
    body: [
      'A session is one agent process working in one git worktree, with its own chat and timeline.',
      'Create one from the New screen: pick a repository, a branch and a harness (optionally an',
      'Agent). Each session gets its own tab. Clear context starts a fresh agent in the same worktree',
      '(the code stays, the conversation resets). Archive hides a session and can remove its worktree',
      '(refused while it holds uncommitted or unpushed work unless you discard); Reopen brings it back',
      'while the worktree exists. Delete removes it permanently — the one destructive verb, always',
      'yours, never an agent’s. Restart re-launches the agent, and is how you change its model or',
      'effort mid-flight. Rename sets the tab’s title.',
    ].join(' '),
  },
  {
    title: 'Harnesses',
    keywords: ['harness', 'claude', 'pi', 'runtime', 'code', 'backend'],
    body: [
      'A harness is the runtime that hosts the model and exposes tools. Flux supports two: Claude Code',
      '(`claude`) and Pi (`pi`). You pick one per session; the box must have that binary on PATH (or',
      'FLUX_CLAUDE / FLUX_PI) or the session is refused. The harness is not the same thing as an Agent',
      '— the harness is the engine, an Agent is a saved preset (model + effort + role + tools) that',
      'runs on top of it. Flux drives both harnesses headless and adds its own operator channel',
      '(flux_ask / flux_notify) to each.',
    ].join(' '),
  },
  {
    title: 'Agents',
    keywords: [
      'agent',
      'agents',
      'model',
      'effort',
      'role',
      'tools',
      'allow',
      'deny',
      'none',
      'preset',
      'read-only',
      'readonly',
    ],
    body: [
      'An Agent is a named, reusable preset you save in Settings and pick at session create: Harness +',
      'Model + Effort + Role + Tools. Model and effort are free-text (each harness has its own',
      'vocabulary). Role is extra system-prompt text appended after Flux’s own prompt, so it can',
      'steer the agent but can never sever your operator channel. Tools has four modes: `all` (the full',
      'toolset), `allow` (only the listed tools), `deny` (everything except the listed tools) and',
      '`none` (no built-in tools). Whatever the mode, the Flux tools floor — flux_ask, flux_notify,',
      'flux_compact and flux_help — is always available, so even a locked-down read-only Agent can',
      'still reach you and look things up. Fields you leave unset fall back to the box default.',
    ].join(' '),
  },
  {
    title: 'Manager agents',
    keywords: ['manager', 'fleet', 'supervise', 'orchestrate', 'subagent', 'sub-agent'],
    body: [
      'A manager is an opt-in Agent capability (toggle it on an Agent in Settings), never part of the',
      'default floor. A manager session gets five extra fleet-control tools over a separate MCP server:',
      'list sessions, open a session, send a prompt to another session, archive (close) a session, and',
      'read a digest of another session’s recent activity. These are the non-destructive verbs only —',
      'a manager can never delete a session, its worktree or its history, and cannot create another',
      'manager. Every action a manager takes is audited into the target session’s timeline, so you can',
      'always see what it did and where.',
    ].join(' '),
  },
  {
    title: 'Skills',
    keywords: ['skill', 'skills', 'slash', 'command', 'template'],
    body: [
      'Skills are box-side reusable instructions the agent can invoke. Add, edit or delete them in',
      'Settings; each is a name and a SKILL.md body stored under the agent’s config directory. In the',
      'composer, typing a single `/name` shows a list of the box’s skills filtered by what you type;',
      'picking one inserts it. Skills live on the box, so they are shared across every session.',
    ].join(' '),
  },
  {
    title: 'Compaction',
    keywords: ['compact', 'compaction', 'context', 'token', 'shrink', 'window'],
    body: [
      'Compaction shrinks the agent’s context at a clean boundary so a long session keeps working',
      'without running out of window. You can trigger it yourself by sending `/compact` (optionally',
      'with a focus, e.g. what to preserve). The agent can also compact itself with the flux_compact',
      'tool between large phases of work. Either way the compaction runs at the next turn boundary; the',
      'app shows a "Compacting…" indicator while it does. The status bar shows current context usage',
      '(e.g. `ctx 239k · 24%`), amber past 70% and red past 90%.',
    ].join(' '),
  },
  {
    title: 'Settings',
    keywords: ['settings', 'config', 'configuration', 'repos', 'notifications', 'devices'],
    body: [
      'The Settings screen holds: paired devices (with Revoke); the box’s runtime settings —',
      'repositories directory, default harness, and which events send a push notification — which you',
      'can change live; environment-only values (relay URL, data dir) shown read-only; your saved',
      'Agents and Skills; and the agent’s own global config (CLAUDE.md and settings.json) as two',
      'editors. Runtime settings you change here override the box’s startup environment and take',
      'effect immediately.',
    ].join(' '),
  },
  {
    title: 'Updating & self-update',
    keywords: ['update', 'upgrade', 'self-update', 'version', 'release', 'checkupdate'],
    body: [
      'Flux ships as one versioned build for all three parts. Open Settings to see the box and app',
      'versions; when the box is behind a published release the app offers Update daemon. The box',
      'discovers the latest release itself, fetches it, and verifies its signature and per-file hashes',
      'against a built-in set of trusted keys before it ever installs — it only runs bytes an offline',
      'key signed. `flux update --check` proves a release from the command line without applying it.',
      'After a self-update the daemon exits cleanly and its supervisor (installed by `flux service',
      'install`) restarts it into the new code.',
    ].join(' '),
  },
  {
    title: 'Troubleshooting',
    keywords: [
      'troubleshoot',
      'trouble',
      'error',
      'problem',
      'disconnected',
      'stuck',
      'no daemon',
      'unavailable',
      'reconnect',
    ],
    body: [
      '"no running daemon" from `flux pair` or `flux devices` means no `flux daemon` is up on the box —',
      'start it (or its service) first. If the app shows a disconnected banner, the box or relay is',
      'offline; it reconnects on its own with backoff and re-syncs, losing nothing. If pairing fails,',
      'the 10-minute window may have lapsed — run `flux pair` for a fresh QR. "Box is on protocol N;',
      'update it" means the box is older than the app — update the daemon. A session refused with',
      '`agent_unavailable` means its harness binary (claude or pi) was not found on the box’s PATH.',
      'If the app says a device was revoked, re-pair it.',
    ].join(' '),
  },
];
