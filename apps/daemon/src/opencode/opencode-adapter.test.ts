import type { Mapped } from '../create-session-supervisor.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { opencodeAdapter } from './opencode-adapter.ts';

// Fixture-driven, as the fixtures rule requires (engineering.md § Testing): the two captured
// `opencode run --format json` NDJSON streams are replayed line by line through the adapter and
// the emitted `Mapped` sequence is asserted. The real opencode is never spawned (ADR 0027).

const fixture = (name: string): string[] =>
  readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/opencode/${name}.jsonl`, import.meta.url)),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.trim() !== '');

// `map` runs the lines left to right, so the adapter accumulates in order; nulls (non-JSON) drop.
const run = (name: string, adapter = opencodeAdapter('/w')): Mapped[] =>
  fixture(name)
    .map((line) => adapter.mapLine(line))
    .filter((m): m is Mapped => m !== null);

interface TurnEnded {
  payload: { costUsd: number; numTurns: number; usage: Record<string, number> };
}

const at = (mapped: Mapped[], i: number): Mapped => mapped[i] as Mapped;

test('a text turn maps to running, one assistant message and turn.ended with the real cost', () => {
  const mapped = run('opencode-text');
  expect(mapped).toHaveLength(3);
  expect(at(mapped, 0)).toMatchObject({
    running: true,
    agentSessionId: 'ses_fa75151e1ffeYvSdLVvMS6Puqt',
  });
  expect(at(mapped, 1).events).toEqual([
    { type: 'msg.assistant', payload: { text: 'hello from opencode' } },
  ]);
  expect(at(mapped, 2).turnEnded).toBe(true);
  expect(at(mapped, 2).events[0]).toEqual({
    type: 'turn.ended',
    payload: {
      costUsd: 0.08430375,
      numTurns: 1,
      stopReason: 'stop',
      usage: { input: 2, output: 8, cacheRead: 0, cacheWrite: 13455 },
    },
  });
});

test('a tool turn maps the bash call, the final text and turn.ended summing both steps', () => {
  const mapped = run('opencode-tool');
  expect(mapped).toHaveLength(6);
  expect(at(mapped, 0).running).toBe(true);
  expect(at(mapped, 1).events.map((e) => e.type)).toEqual(['tool.start', 'tool.end']);
  expect(at(mapped, 1).filesChanged).toBe(true);
  expect(at(mapped, 1).events[0]).toMatchObject({
    type: 'tool.start',
    payload: { name: 'bash', input: { command: 'ls -la' }, summary: 'bash: ls -la' },
  });
  expect(at(mapped, 1).events[1]).toMatchObject({
    type: 'tool.end',
    payload: { ok: true, summary: expect.stringMatching(/^bash ok, \d+ lines$/u) },
  });
  // The intermediate `tool-calls` step accumulates but does not end the turn.
  expect(at(mapped, 2).events).toEqual([]);
  expect(at(mapped, 2).turnEnded).toBeUndefined();
  expect(at(mapped, 4).events[0]).toMatchObject({ type: 'msg.assistant' });
  expect(at(mapped, 5).turnEnded).toBe(true);
  const payload = (at(mapped, 5).events[0] as unknown as TurnEnded).payload;
  expect(payload.numTurns).toBe(2);
  expect(payload.usage).toEqual({ input: 4, output: 86, cacheRead: 13460, cacheWrite: 15000 });
  expect(payload.costUsd).toBeCloseTo(0.10265, 10);
});

test('reset clears the accumulated usage so a re-run starts from zero', () => {
  const adapter = opencodeAdapter('/w');
  run('opencode-text', adapter);
  adapter.reset();
  const mapped = run('opencode-text', adapter);
  const ended = at(mapped, 2).events[0] as unknown as TurnEnded;
  expect(ended.payload.usage['cacheWrite']).toBe(13455);
});
