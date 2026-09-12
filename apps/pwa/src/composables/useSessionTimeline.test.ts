import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { useSessionTimeline } from './useSessionTimeline.ts';

const event = (seq: number, type: string, payload: unknown, parent?: string): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
  ...(parent === undefined ? {} : { parent }),
});

// The rows main shows: top-level, and none of the types that live elsewhere on the screen (the
// status bar, the Changes button, the agents strip, the toolbar's chip) or nowhere (`raw`).
test('main lists top-level rows and hides the types that show elsewhere', () => {
  const events = [
    event(1, 'msg.user', { text: 'go' }),
    event(2, 'raw', { agent: 'claude', data: {} }),
    event(3, 'agent.spec', { model: 'claude-fable-5-1', effort: 'high' }),
    event(4, 'rate_limit', { windows: [] }),
    event(5, 'files.changed', { files: [] }),
    event(6, 'task.progress', { taskId: 't', description: 'd' }),
    event(7, 'msg.assistant', { text: 'sub' }, 'call-1'),
    event(8, 'msg.assistant', { text: 'done' }),
  ];
  const { timeline, select } = useSessionTimeline(() => events);
  expect(timeline.value.map((e) => e.seq)).toEqual([1, 8]);
  select('call-1');
  expect(timeline.value.map((e) => e.seq)).toEqual([7]);
});
