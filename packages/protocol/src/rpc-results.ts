import type { HarnessKind, SessionState, TokenUsage } from './event-payloads.ts';
import { fluxEvent } from './flux-event.ts';
import { guards } from './guards.ts';
import type {
  Commit,
  Device,
  DirEntry,
  FileContent,
  FileStatus,
  Repo,
  RpcMethod,
  RpcMethods,
  SessionSummary,
  Skill,
} from './rpc-methods.ts';
import { settings } from './settings.ts';

// Result guards for every RPC method (protocol.md § 7): the device validates what the box sends
// back, so a malformed or hostile result cannot reach the UI as a trusted value.

type ResultGuards = { [M in RpcMethod]: (value: unknown) => value is RpcMethods[M]['result'] };

const { isString, isBoolean, isNumber, isInteger, isRecord, isArrayOf, isOneOf, isOptional } =
  guards;

const sessionStates: readonly SessionState[] = ['idle', 'running', 'waiting_user', 'ended'];
const harnessKinds: readonly HarnessKind[] = ['claude', 'pi'];

const isHarnessKind = (v: unknown): v is HarnessKind => isOneOf(v, harnessKinds);

const isEmpty = (v: unknown): v is Record<string, never> => isRecord(v);

const isSessionSummary = (v: unknown): v is SessionSummary =>
  isRecord(v) &&
  isString(v['session']) &&
  isString(v['title']) &&
  isString(v['repo']) &&
  isString(v['branch']) &&
  isHarnessKind(v['harness']) &&
  isOptional(v['model'], isString) &&
  isOptional(v['effort'], isString) &&
  isOneOf(v['state'], sessionStates) &&
  isInteger(v['lastSeq'], 0) &&
  isOptional(v['createdAt'], isString) &&
  isString(v['updatedAt']) &&
  isOptional(v['archived'], isBoolean) &&
  isOptional(v['worktreeExists'], isBoolean);

const isTokenUsage = (v: unknown): v is TokenUsage =>
  isRecord(v) &&
  isNumber(v['input']) &&
  isNumber(v['output']) &&
  isNumber(v['cacheRead']) &&
  isNumber(v['cacheWrite']);

const isFileStatus = (v: unknown): v is FileStatus =>
  isRecord(v) &&
  isString(v['path']) &&
  isOneOf(v['status'], ['A', 'M', 'D', 'R', '?']) &&
  isOptional(v['from'], isString);

const isCommit = (v: unknown): v is Commit =>
  isRecord(v) &&
  isString(v['sha']) &&
  isString(v['subject']) &&
  isString(v['author']) &&
  isString(v['ts']);

const isRepo = (v: unknown): v is Repo =>
  isRecord(v) && isString(v['path']) && isString(v['name']) && isArrayOf(v['branches'], isString);

const isDirEntry = (v: unknown): v is DirEntry =>
  isRecord(v) && isString(v['name']) && isOneOf(v['kind'], ['file', 'dir']);

const isDevice = (v: unknown): v is Device =>
  isRecord(v) &&
  isString(v['deviceId']) &&
  isOptional(v['name'], isString) &&
  isString(v['pairedAt']) &&
  isOptional(v['lastSeenAt'], isString) &&
  isBoolean(v['current']);

// `daemon.checkUpdate`: `latest` and `verified` are nullable (not merely optional), and `reason`
// is a non-empty string when present, so each is guarded by hand rather than with `isOptional`.
const isCheckUpdate = (v: unknown): v is RpcMethods['daemon.checkUpdate']['result'] =>
  isRecord(v) &&
  isString(v['current']) &&
  (v['latest'] === null || isString(v['latest'])) &&
  isBoolean(v['available']) &&
  (v['verified'] === null || isBoolean(v['verified'])) &&
  (v['reason'] === undefined || (isString(v['reason']) && v['reason'].length > 0));

const isSkill = (v: unknown): v is Skill =>
  isRecord(v) && isString(v['name']) && isString(v['body']);

const isContent = (v: unknown): v is FileContent =>
  isRecord(v) &&
  isString(v['content']) &&
  isBoolean(v['binary']) &&
  isOptional(v['hash'], isString) &&
  isOptional(v['truncated'], isBoolean);

export const rpcResults: ResultGuards = {
  hello: (v): v is RpcMethods['hello']['result'] =>
    isRecord(v) &&
    isInteger(v['protocol'], 1) &&
    isString(v['daemon']) &&
    isArrayOf(v['sessions'], isSessionSummary) &&
    isOptional(v['vapidPublicKey'], isString) &&
    isOptional(v['agents'], (a): a is HarnessKind[] => isArrayOf(a, isHarnessKind)) &&
    isOptional(v['version'], isString),
  'events.sync': (v): v is RpcMethods['events.sync']['result'] =>
    isRecord(v) && isArrayOf(v['events'], fluxEvent.is) && isBoolean(v['complete']),
  'sessions.list': (v): v is SessionSummary[] => isArrayOf(v, isSessionSummary),
  'sessions.cost': (v): v is RpcMethods['sessions.cost']['result'] =>
    isRecord(v) && isNumber(v['costUsd']) && isTokenUsage(v['usage']) && isInteger(v['turns'], 0),
  'sessions.create': isSessionSummary,
  'sessions.archive': isEmpty,
  'sessions.unarchive': isEmpty,
  'sessions.clear': isEmpty,
  'sessions.restart': isEmpty,
  'sessions.rename': isEmpty,
  'agent.send': (v): v is { seq: number } => isRecord(v) && isInteger(v['seq'], 1),
  'agent.answer': isEmpty,
  'agent.interrupt': isEmpty,
  'comments.add': (v): v is { commentId: string } => isRecord(v) && isString(v['commentId']),
  'comments.remove': isEmpty,
  'git.status': (v): v is { files: FileStatus[] } =>
    isRecord(v) && isArrayOf(v['files'], isFileStatus),
  'git.diff': (v): v is { diff: string } => isRecord(v) && isString(v['diff']),
  'git.show': isContent,
  'git.log': (v): v is { commits: Commit[] } => isRecord(v) && isArrayOf(v['commits'], isCommit),
  'git.commit': (v): v is { sha: string } => isRecord(v) && isString(v['sha']),
  'git.push': (v): v is { remote: string; branch: string } =>
    isRecord(v) && isString(v['remote']) && isString(v['branch']),
  'git.pr': (v): v is { url: string } => isRecord(v) && isString(v['url']),
  'fs.read': isContent,
  'fs.write': (v): v is { hash: string } => isRecord(v) && isString(v['hash']),
  'fs.list': (v): v is { entries: DirEntry[] } =>
    isRecord(v) && isArrayOf(v['entries'], isDirEntry),
  'repos.list': (v): v is { repos: Repo[] } => isRecord(v) && isArrayOf(v['repos'], isRepo),
  'pair.request': (v): v is { deviceId: string } => isRecord(v) && isString(v['deviceId']),
  'push.subscribe': isEmpty,
  'devices.list': (v): v is Device[] => isArrayOf(v, isDevice),
  'devices.remove': isEmpty,
  'settings.get': settings.is,
  'settings.set': settings.is,
  'skills.list': (v): v is { skills: Skill[] } => isRecord(v) && isArrayOf(v['skills'], isSkill),
  'skills.write': isEmpty,
  'skills.delete': isEmpty,
  'daemon.update': isEmpty,
  'daemon.checkUpdate': isCheckUpdate,
  'attach.begin': (v): v is { attachmentId: string } => isRecord(v) && isString(v['attachmentId']),
  'attach.chunk': isEmpty,
  'attach.end': (v): v is { path: string; size: number } =>
    isRecord(v) && isString(v['path']) && isInteger(v['size']),
  'attach.read': (v): v is RpcMethods['attach.read']['result'] =>
    isRecord(v) &&
    isString(v['data']) &&
    isInteger(v['size']) &&
    isString(v['mime']) &&
    isString(v['name']),
  'attach.delete': isEmpty,
};
