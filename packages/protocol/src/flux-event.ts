import type { EventPayloads, EventType } from './event-payloads.ts';
import { eventPayloads } from './event-payloads.ts';
import { guards } from './guards.ts';

// The event log record (protocol.md § 5). `seq` is per session, gapless, from 1.

export interface Envelope<T extends EventType> {
  seq: number;
  ts: string;
  session: string;
  type: T;
  payload: EventPayloads[T];
}

export type FluxEvent = { [T in EventType]: Envelope<T> }[EventType];

const eventTypes = Object.keys(eventPayloads);

const hasEnvelope = (
  v: unknown,
): v is { seq: number; ts: string; session: string; type: string; payload: unknown } =>
  guards.isRecord(v) &&
  guards.isInteger(v['seq'], 1) &&
  guards.isString(v['ts']) &&
  guards.isString(v['session']) &&
  guards.isString(v['type']) &&
  'payload' in v;

const isKnownType = (type: string): type is EventType => eventTypes.includes(type);

// Unknown types are rejected here; the receiving end wraps them as `raw` per protocol.md § 8 so
// an older client can still show that something happened.
const is = (v: unknown): v is FluxEvent =>
  hasEnvelope(v) && isKnownType(v.type) && eventPayloads[v.type](v.payload);

export const fluxEvent: { is: typeof is; types: readonly string[] } = { is, types: eventTypes };
