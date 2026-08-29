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

export type KnownEvent = { [T in EventType]: Envelope<T> }[EventType];

// An event whose type this build does not know (protocol.md § 8): a newer box added it. It is
// kept in the log so `seq` stays gapless and shown as an opaque record. `type` is `string`
// rather than a branded or negated type: TypeScript cannot express "any string but these", and
// every branded spelling either breaks `event.type === 'x'` narrowing or collapses to `never`.
// The cost is that consumers must narrow with `fluxEvent.isKnown` before reading a payload,
// which is exactly the point: nothing can forget that an unknown event may be in the log.
export interface UnknownEvent {
  seq: number;
  ts: string;
  session: string;
  type: string;
  payload: unknown;
}

export type FluxEvent = KnownEvent | UnknownEvent;

const eventTypes = Object.keys(eventPayloads);

const hasEnvelope = (v: unknown): v is UnknownEvent =>
  guards.isRecord(v) &&
  guards.isInteger(v['seq'], 1) &&
  guards.isString(v['ts']) &&
  guards.isString(v['session']) &&
  guards.isString(v['type']) &&
  'payload' in v;

const isKnownType = (type: string): type is EventType => eventTypes.includes(type);

const isKnown = (event: FluxEvent): event is KnownEvent =>
  isKnownType(event.type) && eventPayloads[event.type](event.payload);

// A known type with a payload that fails its guard is corruption and is rejected; an unknown
// type is version skew and is accepted as is (protocol.md § 8).
const is = (v: unknown): v is FluxEvent => hasEnvelope(v) && (!isKnownType(v.type) || isKnown(v));

export const fluxEvent: { is: typeof is; isKnown: typeof isKnown; types: readonly string[] } = {
  is,
  isKnown,
  types: eventTypes,
};
