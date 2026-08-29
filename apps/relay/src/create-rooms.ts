import type { RelayControl, RelayJoin, RelayJoinError } from '@flux/protocol';

// Room registry (protocol.md § 2). One host per room, frames from the host fan out to guests,
// frames from a guest go to the host. Peers are anything that can send and close, so this is
// testable without sockets and knows nothing about WebSockets or IPs.

export interface Peer {
  send: (data: string | Uint8Array) => void;
  close: () => void;
}

export interface Membership {
  role: 'host' | 'guest';
  forward: (data: Uint8Array) => void;
  leave: () => void;
}

export type JoinResult =
  | { ok: true; membership: Membership }
  | { ok: false; error: RelayJoinError };

export interface Rooms {
  join: (roomId: string, join: RelayJoin, peer: Peer) => JoinResult;
  size: () => number;
}

export interface RoomsOptions {
  maxGuests: number;
}

interface Room {
  host: Peer | null;
  guests: Set<Peer>;
}

interface State {
  rooms: Map<string, Room>;
  // The relay cannot derive a room token (it never sees boxPub), so the first host to claim a
  // room registers its token and later claims must match. Tokens outlive the room so a squatter
  // cannot take over while the real host is reconnecting.
  tokens: Map<string, string>;
  maxGuests: number;
}

const control = (type: RelayControl['type']): string => JSON.stringify({ type });

const broadcast = (room: Room, data: string | Uint8Array): void => {
  for (const guest of room.guests) guest.send(data);
};

const roomFor = (state: State, roomId: string): Room => {
  const existing = state.rooms.get(roomId);
  if (existing) return existing;
  const created: Room = { host: null, guests: new Set() };
  state.rooms.set(roomId, created);
  return created;
};

const dropIfEmpty = (state: State, roomId: string, room: Room): void => {
  if (room.host === null && room.guests.size === 0) state.rooms.delete(roomId);
};

const joinHost = (state: State, roomId: string, token: string, peer: Peer): JoinResult => {
  const room = roomFor(state, roomId);
  const registered = state.tokens.get(roomId);
  if (registered !== undefined && registered !== token) {
    dropIfEmpty(state, roomId, room);
    return { ok: false, error: 'bad_token' };
  }
  if (room.host !== null) return { ok: false, error: 'host_present' };
  state.tokens.set(roomId, token);
  room.host = peer;
  broadcast(room, control('host_joined'));
  const leave = (): void => {
    if (room.host !== peer) return;
    room.host = null;
    broadcast(room, control('host_left'));
    dropIfEmpty(state, roomId, room);
  };
  const forward = (data: Uint8Array): void => {
    broadcast(room, data);
  };
  return { ok: true, membership: { role: 'host', forward, leave } };
};

const joinGuest = (state: State, roomId: string, peer: Peer): JoinResult => {
  const room = roomFor(state, roomId);
  if (room.guests.size >= state.maxGuests) {
    dropIfEmpty(state, roomId, room);
    return { ok: false, error: 'room_full' };
  }
  room.guests.add(peer);
  const forward = (data: Uint8Array): void => {
    if (room.host === null) peer.send(control('no_host'));
    else room.host.send(data);
  };
  const leave = (): void => {
    room.guests.delete(peer);
    dropIfEmpty(state, roomId, room);
  };
  return { ok: true, membership: { role: 'guest', forward, leave } };
};

export const createRooms = (options: RoomsOptions): Rooms => {
  const state: State = { rooms: new Map(), tokens: new Map(), maxGuests: options.maxGuests };
  const join = (roomId: string, request: RelayJoin, peer: Peer): JoinResult =>
    request.role === 'host'
      ? joinHost(state, roomId, request.token, peer)
      : joinGuest(state, roomId, peer);
  return { join, size: () => state.rooms.size };
};
