import { attachment } from './attachment.ts';
import type { CodeRef, HarnessKind, SessionState, TokenUsage } from './event-payloads.ts';
import type { FluxEvent } from './flux-event.ts';
import { guards } from './guards.ts';
import { isCodeRef } from './is-code-ref.ts';
import type { Settings, SettingsPatch } from './settings.ts';
import { settings } from './settings.ts';

// RPC methods (protocol.md § 7): params are validated on the box with the guards below; results
// are validated on the device with `rpc-results.ts`.

export interface SessionSummary {
  session: string;
  title: string;
  repo: string;
  branch: string;
  harness: HarnessKind;
  // The configured model and effort the session was spawned with (ADR 0023 § 3), distinct from
  // the running model reported in `agent.context`. Absent when the box spawned on its defaults.
  model?: string;
  effort?: string;
  state: SessionState;
  lastSeq: number;
  // Absent from a daemon built before it was sent (2026-08-29); the device then orders by id.
  createdAt?: string;
  updatedAt: string;
  // Both absent from a daemon built before 2026-08-29, which listed live sessions only: read
  // as not archived, worktree present.
  archived?: boolean;
  // False once the worktree is gone from the box (removed on archive, or by hand); such a
  // session cannot be reopened.
  worktreeExists?: boolean;
}

export interface FileStatus {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | '?';
  from?: string;
}

export interface Commit {
  sha: string;
  subject: string;
  author: string;
  ts: string;
}

export interface Repo {
  path: string;
  name: string;
  branches: string[];
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir';
}

// A file as `git.show` and `fs.read` return it. `hash` is the sha256 hex of the whole file's
// bytes, which `fs.write` takes as `ifMatch`; `truncated` says the content is only the first
// 1 MiB, so it must not be written back. Both are additive (protocol.md § 8).
export interface FileContent {
  content: string;
  binary: boolean;
  hash?: string;
  truncated?: boolean;
}

// A paired device as the box lists it; `current` marks the caller's own device.
export interface Device {
  deviceId: string;
  name?: string;
  pairedAt: string;
  lastSeenAt?: string;
  current: boolean;
}

export interface RpcMethods {
  hello: {
    params: { protocol: number };
    result: {
      protocol: number;
      daemon: string;
      sessions: SessionSummary[];
      vapidPublicKey?: string;
      // Harnesses whose binary the box found at start; absent from older daemons (claude only).
      agents?: HarnessKind[];
      // The daemon's app version (semver, ADR 0021); absent from daemons built before this
      // shipped, so the device feature-detects rather than assuming it is present.
      version?: string;
    };
  };
  'events.sync': {
    params: { session: string; since: number };
    result: { events: FluxEvent[]; complete: boolean };
  };
  'sessions.list': { params: Record<string, never>; result: SessionSummary[] };
  'sessions.cost': {
    params: { session: string };
    result: { costUsd: number; usage: TokenUsage; turns: number };
  };
  'sessions.create': {
    params: {
      repo: string;
      branch: string;
      base?: string;
      harness: HarnessKind;
      title?: string;
      // Configured model and effort (ADR 0023 § 3), loose free-text strings the box compiles to
      // harness flags; omitted to spawn on the box defaults.
      model?: string;
      effort?: string;
    };
    result: SessionSummary;
  };
  // Closes the agent and hides the session. `removeWorktree` also removes the worktree, refused
  // as `dirty` while it holds uncommitted files or unpushed commits unless `discard`;
  // `deleteBranch` (with `removeWorktree` only) then deletes the branch.
  'sessions.archive': {
    params: {
      session: string;
      removeWorktree?: boolean;
      deleteBranch?: boolean;
      discard?: boolean;
    };
    result: Record<string, never>;
  };
  // Shows an archived session again; `not_found` when its worktree is gone.
  'sessions.unarchive': { params: { session: string }; result: Record<string, never> };
  // Drops the agent's context, keeps the worktree and the log: the next send starts fresh.
  'sessions.clear': { params: { session: string }; result: Record<string, never> };
  'sessions.restart': { params: { session: string }; result: Record<string, never> };
  // Gives the session a new title, logged as `session.renamed`; `bad_params` on a blank one.
  'sessions.rename': { params: { session: string; title: string }; result: Record<string, never> };
  // `attachments` are ids from `attach.end`, each complete and belonging to the session.
  'agent.send': {
    params: {
      session: string;
      text: string;
      commentIds?: string[];
      replyTo?: number;
      attachments?: string[];
    };
    result: { seq: number };
  };
  'agent.answer': {
    params: { session: string; askId: string; answer: string };
    result: Record<string, never>;
  };
  'agent.interrupt': { params: { session: string }; result: Record<string, never> };
  'comments.add': {
    params: { session: string; ref: CodeRef; text: string };
    result: { commentId: string };
  };
  'comments.remove': {
    params: { session: string; commentId: string };
    result: Record<string, never>;
  };
  'git.status': { params: { session: string }; result: { files: FileStatus[] } };
  'git.diff': {
    params: { session: string; path?: string; from?: string; to?: string };
    result: { diff: string };
  };
  'git.show': {
    params: { session: string; path: string; rev: string };
    result: FileContent;
  };
  'git.log': { params: { session: string; limit?: number }; result: { commits: Commit[] } };
  // Stages `paths` (or every change, untracked included, when omitted) and commits.
  'git.commit': {
    params: { session: string; message: string; paths?: string[] };
    result: { sha: string };
  };
  // Never forces. The first push of a branch sets its upstream; `setUpstream` forces that.
  'git.push': {
    params: { session: string; setUpstream?: boolean };
    result: { remote: string; branch: string };
  };
  // `gh pr create` in the worktree; an existing PR for the branch is returned instead.
  'git.pr': {
    params: { session: string; title: string; body?: string; base?: string; draft?: boolean };
    result: { url: string };
  };
  'fs.read': {
    params: { session: string; path: string };
    result: FileContent;
  };
  'fs.write': {
    params: { session: string; path: string; content: string; ifMatch?: string };
    result: { hash: string };
  };
  'fs.list': { params: { session: string; path: string }; result: { entries: DirEntry[] } };
  'repos.list': { params: Record<string, never>; result: { repos: Repo[] } };
  'pair.request': { params: { devPub: string; proof: string }; result: { deviceId: string } };
  'push.subscribe': { params: { subscription: unknown }; result: Record<string, never> };
  'devices.list': { params: Record<string, never>; result: Device[] };
  'devices.remove': { params: { deviceId: string }; result: Record<string, never> };
  'settings.get': { params: Record<string, never>; result: Settings };
  'settings.set': { params: SettingsPatch; result: Settings };
  // Installs the named release and restarts (ADR 0022): the daemon fetches that GitHub release,
  // verifies its signature, atomically swaps its files and exits for the supervisor to restart.
  // Returns `{}` at once; progress and failure arrive as the `update.progress` / `update.failed`
  // ephemerals, and success has no event (the channel drops and the device reads the new
  // `hello.version` on reconnect). Refused with `unsupported` for a target that is not valid
  // semver, not newer than the running build, below the 1.0.0 floor, or on a daemon run from
  // source.
  'daemon.update': { params: { version: string }; result: Record<string, never> };
  // File attachments, chunked over the channel (ADR 0020): begin, sequential chunks of at most
  // `attachment.limits.chunkBytes` raw bytes as base64, then end with the sha256 hex of the
  // whole file. `too_large` past the per-file cap; an out-of-order or duplicate chunk and a
  // hash mismatch are `bad_params`, the latter also deleting the partial file.
  'attach.begin': {
    params: { session: string; name: string; mime: string; size: number };
    result: { attachmentId: string };
  };
  'attach.chunk': {
    params: { attachmentId: string; index: number; data: string };
    result: Record<string, never>;
  };
  'attach.end': {
    params: { attachmentId: string; hash: string };
    result: { path: string; size: number };
  };
  // A slice of a stored attachment, `length` capped at `attachment.limits.readBytes`.
  'attach.read': {
    params: { attachmentId: string; offset: number; length: number };
    result: { data: string; size: number; mime: string; name: string };
  };
  // Removes an attachment the operator took off the message before sending it.
  'attach.delete': { params: { attachmentId: string }; result: Record<string, never> };
}

export type RpcMethod = keyof RpcMethods;

export type RpcErrorCode =
  | 'bad_params'
  | 'not_found'
  | 'not_paired'
  | 'agent_unavailable'
  | 'git_error'
  | 'gh_error'
  | 'conflict'
  | 'dirty'
  | 'too_large'
  // A `daemon.update` target the daemon refuses outright (ADR 0022): not valid semver, not newer
  // than the running build, below the 1.0.0 floor, or a daemon running from source.
  | 'unsupported'
  | 'internal';

type ParamGuards = { [M in RpcMethod]: (value: unknown) => value is RpcMethods[M]['params'] };

const { isString, isBoolean, isInteger, isRecord, isArrayOf, isOneOf, isOptional } = guards;

const isEmpty = (v: unknown): v is Record<string, never> =>
  isRecord(v) && Object.keys(v).length === 0;

const withSession = (v: unknown): v is Record<string, unknown> & { session: string } =>
  isRecord(v) && isString(v['session']);

// `model`/`effort` are loose free-text (ADR 0023 § 3): the guard checks non-empty, not membership
// of an enum, since the two harnesses' vocabularies differ and both move every release.
const isFilledString = (v: unknown): v is string => isString(v) && v.length > 0;

export const rpcMethods: ParamGuards = {
  hello: (v): v is RpcMethods['hello']['params'] => isRecord(v) && isInteger(v['protocol'], 1),
  'events.sync': (v): v is RpcMethods['events.sync']['params'] =>
    withSession(v) && isInteger(v['since']),
  'sessions.list': isEmpty,
  'sessions.cost': withSession,
  'sessions.create': (v): v is RpcMethods['sessions.create']['params'] =>
    isRecord(v) &&
    isString(v['repo']) &&
    isString(v['branch']) &&
    isOptional(v['base'], isString) &&
    isOneOf(v['harness'], ['claude', 'pi']) &&
    isOptional(v['title'], isString) &&
    isOptional(v['model'], isFilledString) &&
    isOptional(v['effort'], isFilledString),
  'sessions.archive': (v): v is RpcMethods['sessions.archive']['params'] =>
    withSession(v) &&
    isOptional(v['removeWorktree'], isBoolean) &&
    isOptional(v['deleteBranch'], isBoolean) &&
    isOptional(v['discard'], isBoolean),
  'sessions.unarchive': withSession,
  'sessions.clear': withSession,
  'sessions.restart': withSession,
  'sessions.rename': (v): v is RpcMethods['sessions.rename']['params'] =>
    withSession(v) && isString(v['title']),
  'agent.send': (v): v is RpcMethods['agent.send']['params'] =>
    withSession(v) &&
    isString(v['text']) &&
    isOptional(v['commentIds'], (c): c is string[] => isArrayOf(c, isString)) &&
    isOptional(v['replyTo'], (n): n is number => isInteger(n, 1)) &&
    isOptional(v['attachments'], (a): a is string[] => isArrayOf(a, isString)),
  'agent.answer': (v): v is RpcMethods['agent.answer']['params'] =>
    withSession(v) && isString(v['askId']) && isString(v['answer']),
  'agent.interrupt': withSession,
  'comments.add': (v): v is RpcMethods['comments.add']['params'] =>
    withSession(v) && isCodeRef(v['ref']) && isString(v['text']),
  'comments.remove': (v): v is RpcMethods['comments.remove']['params'] =>
    withSession(v) && isString(v['commentId']),
  'git.status': withSession,
  'git.diff': (v): v is RpcMethods['git.diff']['params'] =>
    withSession(v) &&
    isOptional(v['path'], isString) &&
    isOptional(v['from'], isString) &&
    isOptional(v['to'], isString),
  'git.show': (v): v is RpcMethods['git.show']['params'] =>
    withSession(v) && isString(v['path']) && isString(v['rev']),
  'git.log': (v): v is RpcMethods['git.log']['params'] =>
    withSession(v) && isOptional(v['limit'], (n): n is number => isInteger(n, 1)),
  'git.commit': (v): v is RpcMethods['git.commit']['params'] =>
    withSession(v) &&
    isString(v['message']) &&
    isOptional(v['paths'], (p): p is string[] => isArrayOf(p, isString)),
  'git.push': (v): v is RpcMethods['git.push']['params'] =>
    withSession(v) && isOptional(v['setUpstream'], isBoolean),
  'git.pr': (v): v is RpcMethods['git.pr']['params'] =>
    withSession(v) &&
    isString(v['title']) &&
    isOptional(v['body'], isString) &&
    isOptional(v['base'], isString) &&
    isOptional(v['draft'], isBoolean),
  'fs.read': (v): v is RpcMethods['fs.read']['params'] => withSession(v) && isString(v['path']),
  'fs.write': (v): v is RpcMethods['fs.write']['params'] =>
    withSession(v) &&
    isString(v['path']) &&
    isString(v['content']) &&
    isOptional(v['ifMatch'], isString),
  'fs.list': (v): v is RpcMethods['fs.list']['params'] => withSession(v) && isString(v['path']),
  'repos.list': isEmpty,
  'pair.request': (v): v is RpcMethods['pair.request']['params'] =>
    isRecord(v) && isString(v['devPub']) && isString(v['proof']),
  'push.subscribe': (v): v is RpcMethods['push.subscribe']['params'] =>
    isRecord(v) && isRecord(v['subscription']),
  'devices.list': isEmpty,
  'devices.remove': (v): v is RpcMethods['devices.remove']['params'] =>
    isRecord(v) && isString(v['deviceId']),
  'settings.get': isEmpty,
  'settings.set': settings.isPatch,
  'daemon.update': (v): v is RpcMethods['daemon.update']['params'] =>
    isRecord(v) && isString(v['version']),
  'attach.begin': (v): v is RpcMethods['attach.begin']['params'] =>
    withSession(v) && isString(v['name']) && isString(v['mime']) && isInteger(v['size']),
  'attach.chunk': (v): v is RpcMethods['attach.chunk']['params'] =>
    isRecord(v) && isString(v['attachmentId']) && isInteger(v['index']) && isString(v['data']),
  'attach.end': (v): v is RpcMethods['attach.end']['params'] =>
    isRecord(v) && isString(v['attachmentId']) && isString(v['hash']),
  'attach.read': (v): v is RpcMethods['attach.read']['params'] =>
    isRecord(v) &&
    isString(v['attachmentId']) &&
    isInteger(v['offset']) &&
    isInteger(v['length'], 1) &&
    v['length'] <= attachment.limits.readBytes,
  'attach.delete': (v): v is RpcMethods['attach.delete']['params'] =>
    isRecord(v) && isString(v['attachmentId']),
};
