import { expect, test } from 'vitest';

import type { JoinResult, Membership, Peer } from './create-rooms.ts';
import { createRooms } from './create-rooms.ts';

interface FakePeer extends Peer {
  received: (string | Uint8Array)[];
  closed: boolean;
}

const peer = (): FakePeer => {
  const p: FakePeer = {
    received: [],
    closed: false,
    send: (data) => {
      p.received.push(data);
    },
    close: () => {
      p.closed = true;
    },
  };
  return p;
};

// Tests may not branch, so a failed join is an error rather than a skipped assertion.
const must = (result: JoinResult): Membership => {
  if (result.ok) return result.membership;
  throw new Error(result.error);
};

const host = { v: 2, role: 'host', token: 't1' } as const;
const guest = { v: 2, role: 'guest' } as const;
const frame = new Uint8Array([2, 3, 4]);

test('host frames fan out to every guest, guest frames go to the host', () => {
  const rooms = createRooms({ maxGuests: 8 });
  const h = peer();
  const g1 = peer();
  const g2 = peer();
  const hm = must(rooms.join('r', host, h));
  const gm1 = must(rooms.join('r', guest, g1));
  must(rooms.join('r', guest, g2));
  hm.forward(frame);
  expect(g1.received).toEqual([frame]);
  expect(g2.received).toEqual([frame]);
  gm1.forward(frame);
  expect(h.received).toEqual([frame]);
  expect(g2.received).toHaveLength(1);
});

test('a guest without a host gets no_host and the frame is dropped', () => {
  const rooms = createRooms({ maxGuests: 8 });
  const g = peer();
  must(rooms.join('r', guest, g)).forward(frame);
  expect(g.received).toEqual(['{"type":"no_host"}']);
});

test('guests learn when the host joins and leaves', () => {
  const rooms = createRooms({ maxGuests: 8 });
  const g = peer();
  rooms.join('r', guest, g);
  must(rooms.join('r', host, peer())).leave();
  expect(g.received).toEqual(['{"type":"host_joined"}', '{"type":"host_left"}']);
});

test('a second host is refused while the first is present', () => {
  const rooms = createRooms({ maxGuests: 8 });
  rooms.join('r', host, peer());
  expect(rooms.join('r', host, peer())).toEqual({ ok: false, error: 'host_present' });
});

test('the first token registered for a room is the only one accepted afterwards', () => {
  const rooms = createRooms({ maxGuests: 8 });
  must(rooms.join('r', host, peer())).leave();
  expect(rooms.size()).toBe(0);
  expect(rooms.join('r', { ...host, token: 'other' }, peer())).toEqual({
    ok: false,
    error: 'bad_token',
  });
  expect(rooms.join('r', host, peer()).ok).toBe(true);
});

test('rooms are independent', () => {
  const rooms = createRooms({ maxGuests: 8 });
  expect(rooms.join('a', host, peer()).ok).toBe(true);
  expect(rooms.join('b', { ...host, token: 'tb' }, peer()).ok).toBe(true);
  expect(rooms.size()).toBe(2);
});

test('guest limit is enforced per room', () => {
  const rooms = createRooms({ maxGuests: 1 });
  expect(rooms.join('r', guest, peer()).ok).toBe(true);
  expect(rooms.join('r', guest, peer())).toEqual({ ok: false, error: 'room_full' });
  expect(rooms.join('s', guest, peer()).ok).toBe(true);
});

test('leaving twice or after replacement is harmless', () => {
  const rooms = createRooms({ maxGuests: 8 });
  const g = peer();
  const gm = must(rooms.join('r', guest, g));
  const hm = must(rooms.join('r', host, peer()));
  hm.leave();
  hm.leave();
  const hm2 = must(rooms.join('r', host, peer()));
  hm.leave();
  expect(g.received).toEqual([
    '{"type":"host_joined"}',
    '{"type":"host_left"}',
    '{"type":"host_joined"}',
  ]);
  gm.leave();
  gm.leave();
  expect(rooms.size()).toBe(1);
  hm2.leave();
  expect(rooms.size()).toBe(0);
});
