import { guards } from './guards.ts';
import { protocolVersion } from './protocol-version.ts';

// The only plaintext the relay understands (protocol.md § 2): the first message from a
// connecting party, its reply, and the three control frames the relay originates.

export type RelayJoin = { v: 1; role: 'host'; token: string } | { v: 1; role: 'guest' };

export type RelayJoinError = 'bad_version' | 'bad_token' | 'host_present' | 'room_full';

export type RelayJoinReply = { ok: true } | { ok: false; error: RelayJoinError };

export interface RelayControl {
  type: 'no_host' | 'host_joined' | 'host_left';
}

const { isString, isRecord, isOneOf } = guards;

const isJoin = (v: unknown): v is RelayJoin =>
  isRecord(v) &&
  v['v'] === protocolVersion &&
  (v['role'] === 'guest' || (v['role'] === 'host' && isString(v['token'])));

const isJoinReply = (v: unknown): v is RelayJoinReply =>
  isRecord(v) &&
  (v['ok'] === true ||
    (v['ok'] === false &&
      isOneOf(v['error'], ['bad_version', 'bad_token', 'host_present', 'room_full'])));

const isControl = (v: unknown): v is RelayControl =>
  isRecord(v) && isOneOf(v['type'], ['no_host', 'host_joined', 'host_left']);

export const relayMessage: {
  isJoin: typeof isJoin;
  isJoinReply: typeof isJoinReply;
  isControl: typeof isControl;
} = { isJoin, isJoinReply, isControl };
