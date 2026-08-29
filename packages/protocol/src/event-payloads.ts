import { guards } from './guards.ts';
import { isCodeRef } from './is-code-ref.ts';

// Payload shapes and guards for every event type (protocol.md § 5). One guard per type, looked up
// by the envelope guard in flux-event.ts. Adding an event means a type, a guard and a test here.

const { isString, isBoolean, isNumber, isInteger, isRecord, isArrayOf, isOneOf, isOptional } =
  guards;

const agentKinds = ['claude', 'pi'] as const;
export type AgentKind = (typeof agentKinds)[number];

const sessionStates = ['idle', 'running', 'waiting_user', 'ended'] as const;
export type SessionState = (typeof sessionStates)[number];

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface RateWindow {
  name: string;
  utilisation: number;
  resetsAt: string;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface CodeRef {
  path: string;
  rev: string;
  range?: LineRange;
}

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  from?: string;
}

export interface EventPayloads {
  'session.created': {
    repo: string;
    worktree: string;
    branch: string;
    base: string;
    agent: AgentKind;
    agentSessionId?: string;
    title?: string;
  };
  'session.state': { state: SessionState; reason?: string };
  'session.renamed': { title: string };
  'msg.user': { text: string; refs?: CodeRef[]; commentIds?: string[] };
  'msg.assistant': { text: string };
  'tool.start': { toolId: string; name: string; input: unknown; summary: string };
  'tool.end': { toolId: string; ok: boolean; summary: string; output?: unknown };
  'turn.ended': {
    costUsd?: number;
    durationMs?: number;
    numTurns?: number;
    stopReason?: string;
    usage?: TokenUsage;
  };
  rate_limit: { windows: RateWindow[] };
  ask: { askId: string; question: string; options?: string[]; timeoutAt: string };
  'ask.answered': { askId: string; answer: string; by: 'device' | 'timeout' | 'aborted' };
  notify: { level: 'info' | 'done' | 'blocked'; summary: string };
  'files.changed': { files: ChangedFile[] };
  'comment.added': { commentId: string; ref: CodeRef; text: string };
  'comment.removed': { commentId: string };
  'comment.sent': { commentIds: string[]; msgSeq: number };
  raw: { agent: string; data: unknown };
}

export type EventType = keyof EventPayloads;

type PayloadGuards = { [T in EventType]: (value: unknown) => value is EventPayloads[T] };

const isStrings = (value: unknown): value is string[] => isArrayOf(value, isString);

const isTokenUsage = (v: unknown): v is TokenUsage =>
  isRecord(v) &&
  isInteger(v['input']) &&
  isInteger(v['output']) &&
  isInteger(v['cacheRead']) &&
  isInteger(v['cacheWrite']);

const isRateWindow = (v: unknown): v is RateWindow =>
  isRecord(v) &&
  isString(v['name']) &&
  isNumber(v['utilisation']) &&
  v['utilisation'] >= 0 &&
  v['utilisation'] <= 1 &&
  isString(v['resetsAt']);

const isChangedFile = (v: unknown): v is ChangedFile =>
  isRecord(v) &&
  isString(v['path']) &&
  isOneOf(v['status'], ['A', 'M', 'D', 'R']) &&
  isOptional(v['from'], isString);

export const eventPayloads: PayloadGuards = {
  'session.created': (v): v is EventPayloads['session.created'] =>
    isRecord(v) &&
    isString(v['repo']) &&
    isString(v['worktree']) &&
    isString(v['branch']) &&
    isString(v['base']) &&
    isOneOf(v['agent'], agentKinds) &&
    isOptional(v['agentSessionId'], isString) &&
    isOptional(v['title'], isString),
  'session.state': (v): v is EventPayloads['session.state'] =>
    isRecord(v) && isOneOf(v['state'], sessionStates) && isOptional(v['reason'], isString),
  'session.renamed': (v): v is EventPayloads['session.renamed'] =>
    isRecord(v) && isString(v['title']),
  'msg.user': (v): v is EventPayloads['msg.user'] =>
    isRecord(v) &&
    isString(v['text']) &&
    isOptional(v['refs'], (r): r is CodeRef[] => isArrayOf(r, isCodeRef)) &&
    isOptional(v['commentIds'], isStrings),
  'msg.assistant': (v): v is EventPayloads['msg.assistant'] => isRecord(v) && isString(v['text']),
  'tool.start': (v): v is EventPayloads['tool.start'] =>
    isRecord(v) &&
    isString(v['toolId']) &&
    isString(v['name']) &&
    'input' in v &&
    isString(v['summary']),
  'tool.end': (v): v is EventPayloads['tool.end'] =>
    isRecord(v) && isString(v['toolId']) && isBoolean(v['ok']) && isString(v['summary']),
  'turn.ended': (v): v is EventPayloads['turn.ended'] =>
    isRecord(v) &&
    isOptional(v['costUsd'], isNumber) &&
    isOptional(v['durationMs'], isInteger) &&
    isOptional(v['numTurns'], isInteger) &&
    isOptional(v['stopReason'], isString) &&
    isOptional(v['usage'], isTokenUsage),
  rate_limit: (v): v is EventPayloads['rate_limit'] =>
    isRecord(v) && isArrayOf(v['windows'], isRateWindow),
  ask: (v): v is EventPayloads['ask'] =>
    isRecord(v) &&
    isString(v['askId']) &&
    isString(v['question']) &&
    isOptional(v['options'], isStrings) &&
    isString(v['timeoutAt']),
  'ask.answered': (v): v is EventPayloads['ask.answered'] =>
    isRecord(v) &&
    isString(v['askId']) &&
    isString(v['answer']) &&
    isOneOf(v['by'], ['device', 'timeout', 'aborted']),
  notify: (v): v is EventPayloads['notify'] =>
    isRecord(v) && isOneOf(v['level'], ['info', 'done', 'blocked']) && isString(v['summary']),
  'files.changed': (v): v is EventPayloads['files.changed'] =>
    isRecord(v) && isArrayOf(v['files'], isChangedFile),
  'comment.added': (v): v is EventPayloads['comment.added'] =>
    isRecord(v) && isString(v['commentId']) && isCodeRef(v['ref']) && isString(v['text']),
  'comment.removed': (v): v is EventPayloads['comment.removed'] =>
    isRecord(v) && isString(v['commentId']),
  'comment.sent': (v): v is EventPayloads['comment.sent'] =>
    isRecord(v) && isStrings(v['commentIds']) && isInteger(v['msgSeq'], 1),
  raw: (v): v is EventPayloads['raw'] => isRecord(v) && isString(v['agent']) && 'data' in v,
};
