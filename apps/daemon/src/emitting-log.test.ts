import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createEventLog } from './create-event-log.ts';
import { emittingLog } from './emitting-log.ts';
import { openDatabase } from './open-database.ts';

test('every append is logged and emitted once, with the seq the log gave it', () => {
  const log = createEventLog({ db: openDatabase(':memory:') });
  const emitted: FluxEvent[] = [];
  const wrapped = emittingLog(log, (event) => {
    emitted.push(event);
  });
  const first = wrapped.append('s1', { type: 'session.state', payload: { state: 'idle' } });
  const second = wrapped.append('s1', { type: 'session.state', payload: { state: 'running' } });
  expect(emitted).toEqual([first, second]);
  expect(second.seq).toBe(2);
  expect(wrapped.lastSeq('s1')).toBe(2);
  expect(wrapped.read('s1', 0).events).toEqual([first, second]);
});
