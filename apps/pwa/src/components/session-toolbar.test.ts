import type { FluxEvent, SessionSummary } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import SessionToolbar from './SessionToolbar.vue';

const base: SessionSummary = {
  session: 's1',
  title: 'First',
  repo: '/repos/r',
  branch: 'flux/one',
  harness: 'claude',
  state: 'idle',
  lastSeq: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const spec = (seq: number, payload: unknown): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type: 'agent.spec',
  payload,
});

const toolbar = async (summary: SessionSummary | null, events: FluxEvent[] = []) => {
  const box = await pairedStore();
  box.store.state.sessions = summary === null ? [] : [summary];
  const wrapper = mount(SessionToolbar, {
    props: { store: box.store, session: 's1', events, branch: 'flux/one', busy: false },
  });
  return { box, wrapper };
};

test('the chip shows the running model and effort from the latest agent.spec', async () => {
  const { box, wrapper } = await toolbar({ ...base, model: 'fable', effort: 'low' }, [
    spec(1, { model: 'claude-fable-5' }),
    spec(2, { model: 'claude-fable-5-1', effort: 'high' }),
  ]);
  const chip = wrapper.find('.spec-chip');
  expect(chip.text()).toBe('fable-5-1:high');
  expect(chip.attributes('title')).toBe('Claude Code · claude-fable-5-1:high');
  box.store.stop();
});

test('the chip shows the model alone while the box has not learnt the effort', async () => {
  const { box, wrapper } = await toolbar(base, [spec(1, { model: 'claude-fable-5' })]);
  expect(wrapper.find('.spec-chip').text()).toBe('fable-5');
  box.store.stop();
});

test('the chip drops a dated snapshot suffix and leaves other ids alone', async () => {
  const dated = await toolbar(base, [
    spec(1, { model: 'claude-opus-4-5-20251101', effort: 'low' }),
  ]);
  expect(dated.wrapper.find('.spec-chip').text()).toBe('opus-4-5:low');
  expect(dated.wrapper.find('.spec-chip').attributes('title')).toBe(
    'Claude Code · claude-opus-4-5-20251101:low',
  );
  dated.box.store.stop();
  const suffixed = await toolbar(base, [spec(1, { model: 'claude-sonnet-4-5-20250929[1m]' })]);
  expect(suffixed.wrapper.find('.spec-chip').text()).toBe('sonnet-4-5[1m]');
  suffixed.box.store.stop();
  const other = await toolbar({ ...base, harness: 'pi' }, [spec(1, { model: 'gpt-5-mini' })]);
  expect(other.wrapper.find('.spec-chip').text()).toBe('gpt-5-mini');
  expect(other.wrapper.find('.spec-chip').attributes('title')).toBe('Pi · gpt-5-mini');
  other.box.store.stop();
});

test('the chip shows the harness until the agent has said what it runs', async () => {
  const { box, wrapper } = await toolbar({ ...base, model: 'opus', effort: 'high' });
  expect(wrapper.find('.spec-chip').text()).toBe('Claude Code');
  expect(wrapper.find('.spec-chip').attributes('title')).toBe('Claude Code');
  box.store.stop();
});

test('the chip labels pi and other harnesses', async () => {
  const { box, wrapper } = await toolbar({ ...base, harness: 'pi' });
  expect(wrapper.find('.spec-chip').text()).toBe('Pi');
  box.store.stop();
});

test('no chip is shown when the session is not in the list and nothing is running', async () => {
  const { box, wrapper } = await toolbar(null);
  expect(wrapper.find('.spec-chip').exists()).toBe(false);
  box.store.stop();
});

test('the running spec shows even for a session missing from the list', async () => {
  const { box, wrapper } = await toolbar(null, [spec(1, { model: 'm', effort: 'e' })]);
  expect(wrapper.find('.spec-chip').text()).toBe('m:e');
  expect(wrapper.find('.spec-chip').attributes('title')).toBe('m:e');
  box.store.stop();
});
