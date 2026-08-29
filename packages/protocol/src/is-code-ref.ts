import type { CodeRef, LineRange } from './event-payloads.ts';
import { guards } from './guards.ts';

// A code reference (protocol.md § 5) is used by events, RPC params and the daemon's stores, so
// its guard lives once, here.

const { isString, isInteger, isRecord, isOptional } = guards;

const isLineRange = (v: unknown): v is LineRange =>
  isRecord(v) &&
  isInteger(v['startLine'], 1) &&
  isInteger(v['endLine'], 1) &&
  v['endLine'] >= v['startLine'];

export const isCodeRef = (v: unknown): v is CodeRef =>
  isRecord(v) && isString(v['path']) && isString(v['rev']) && isOptional(v['range'], isLineRange);
