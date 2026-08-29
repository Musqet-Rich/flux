import type { AgentKind, CodeRef, SessionState, TokenUsage } from './event-payloads.ts';
import type { FluxEvent } from './flux-event.ts';
import { guards } from './guards.ts';
import { isCodeRef } from './is-code-ref.ts';

// RPC methods (protocol.md § 7): params are validated on the box with the guards below; results
// are typed only, the box constructs them. Settings and devices are P2 and not listed yet.

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

export interface RpcMethods {
  hello: {
    params: { protocol: number };
    result: { protocol: number; daemon: string; sessions: SessionSummary[] };
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
    result: { content: string; binary: boolean };
  };
  'git.log': { params: { session: string; limit?: number }; result: { commits: Commit[] } };
  'fs.read': {
    params: { session: string; path: string };
    result: { content: string; binary: boolean };
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
  | 'internal';

type ParamGuards = { [M in RpcMethod]: (value: unknown) => value is RpcMethods[M]['params'] };

const { isString, isInteger, isRecord, isArrayOf, isOneOf, isOptional } = guards;

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
  'fs.read': (v): v is RpcMethods['fs.read']['params'] => withSession(v) && isString(v['path']),
  'fs.list': (v): v is RpcMethods['fs.list']['params'] => withSession(v) && isString(v['path']),
  'repos.list': isEmpty,
  'pair.request': (v): v is RpcMethods['pair.request']['params'] =>
    isRecord(v) && isString(v['devPub']) && isString(v['proof']),
  'push.subscribe': (v): v is RpcMethods['push.subscribe']['params'] =>
    isRecord(v) && isRecord(v['subscription']),
};
