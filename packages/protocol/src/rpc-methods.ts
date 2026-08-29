import type { AgentKind, CodeRef, SessionState, TokenUsage } from './event-payloads.ts';
import type { FluxEvent } from './flux-event.ts';
import { guards } from './guards.ts';
import { isCodeRef } from './is-code-ref.ts';

// RPC methods (protocol.md § 7): params are validated on the box with the guards below; results
// are validated on the device with `rpc-results.ts`. Settings and devices are P2 and not listed yet.

export interface SessionSummary {
  session: string;
  title: string;
  repo: string;
  branch: string;
  agent: AgentKind;
  state: SessionState;
  lastSeq: number;
  updatedAt: string;
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

export interface RpcMethods {
  hello: {
    params: { protocol: number };
    result: {
      protocol: number;
      daemon: string;
      sessions: SessionSummary[];
      vapidPublicKey?: string;
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
    params: { repo: string; branch: string; base?: string; agent: AgentKind; title?: string };
    result: SessionSummary;
  };
  'sessions.archive': { params: { session: string }; result: Record<string, never> };
  'sessions.restart': { params: { session: string }; result: Record<string, never> };
  'agent.send': {
    params: { session: string; text: string; commentIds?: string[] };
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
  | 'internal';

type ParamGuards = { [M in RpcMethod]: (value: unknown) => value is RpcMethods[M]['params'] };

const { isString, isBoolean, isInteger, isRecord, isArrayOf, isOneOf, isOptional } = guards;

const isEmpty = (v: unknown): v is Record<string, never> =>
  isRecord(v) && Object.keys(v).length === 0;

const withSession = (v: unknown): v is Record<string, unknown> & { session: string } =>
  isRecord(v) && isString(v['session']);

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
    isOneOf(v['agent'], ['claude', 'pi']) &&
    isOptional(v['title'], isString),
  'sessions.archive': withSession,
  'sessions.restart': withSession,
  'agent.send': (v): v is RpcMethods['agent.send']['params'] =>
    withSession(v) &&
    isString(v['text']) &&
    isOptional(v['commentIds'], (c): c is string[] => isArrayOf(c, isString)),
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
};
