import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { claudeAdapter } from './claude-adapter.ts';
import { transcriptPath } from './transcript-path.ts';

// Lines as Claude Code 2.1.251 prints them (fixtures/claude/session-thinking-tasks-pr).
const start = JSON.stringify({
  type: 'stream_event',
  event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
});
const stop = JSON.stringify({
  type: 'stream_event',
  event: { type: 'content_block_stop', index: 0 },
});
const tokens = (n: number): string =>
  JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: n });

const messageStart = (model: string): string =>
  JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        model,
        usage: {
          input_tokens: 56,
          cache_creation_input_tokens: 176,
          cache_read_input_tokens: 238328,
        },
      },
    },
  });

// A config dir with no transcripts under it, so the default reader finds nothing.
const nowhere = '/nonexistent/claude';

const withClock = (): { adapter: ReturnType<typeof claudeAdapter>; clock: { now: number } } => {
  const clock = { now: 1000 };
  return { adapter: claudeAdapter('/w', { configDir: nowhere, now: () => clock.now }), clock };
};

test('thinking start and stop always pass, token counts are throttled by time or step', () => {
  const { adapter, clock } = withClock();
  expect(adapter.mapLine(start)?.thinking).toEqual({ active: true });
  // 10 ms and 50 tokens after the start: neither threshold reached.
  clock.now += 10;
  expect(adapter.mapLine(tokens(50))?.thinking).toBeUndefined();
  // 100 tokens since the last one sent (the start counted as 0).
  expect(adapter.mapLine(tokens(100))?.thinking).toEqual({ active: true, estimatedTokens: 100 });
  expect(adapter.mapLine(tokens(150))?.thinking).toBeUndefined();
  // 500 ms later the same count goes through.
  clock.now += 500;
  expect(adapter.mapLine(tokens(150))?.thinking).toEqual({ active: true, estimatedTokens: 150 });
  expect(adapter.mapLine(stop)?.thinking).toEqual({ active: false });
  // A new block starts from zero again, so 100 tokens is a step even 1 ms later.
  clock.now += 1;
  expect(adapter.mapLine(start)?.thinking).toEqual({ active: true });
  expect(adapter.mapLine(tokens(100))?.thinking).toEqual({ active: true, estimatedTokens: 100 });
});

test('a dropped count still maps the line (to nothing) and other lines are untouched', () => {
  const { adapter } = withClock();
  adapter.mapLine(start);
  const dropped = adapter.mapLine(tokens(10));
  expect(dropped).toEqual({ events: [] });
  const other = adapter.mapLine(JSON.stringify({ type: 'system', subtype: 'hook_started' }));
  expect(other?.events[0]?.type).toBe('raw');
  expect(adapter.mapLine('not json')).toBeNull();
});

test('message_start becomes a context signal, untouched by the thinking throttle', () => {
  const { adapter } = withClock();
  adapter.mapLine(start);
  expect(adapter.mapLine(messageStart('claude-fable-5'))).toEqual({
    events: [],
    context: { tokens: 238560, model: 'claude-fable-5' },
    spec: { model: 'claude-fable-5' },
  });
});

test('reset forgets the open thinking block so a later stop of that index is raw', () => {
  const { adapter } = withClock();
  adapter.mapLine(start);
  adapter.reset();
  const after = adapter.mapLine(stop);
  expect(after?.thinking).toBeUndefined();
  expect(after?.events[0]?.type).toBe('raw');
});

// The running spec (protocol.md § 5 `agent.spec`): the mapper names the model from
// message_start; the adapter reads the effort from the transcript at each turn's end and
// carries it on later restatements. `init` names the transcript, and the configured model,
// which is not the spec.
const cwd = '/private/tmp/w';
const init = (sessionId = 'sid-1', dir = cwd): string =>
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'fable',
    cwd: dir,
  });
const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false });

const withLevels = (
  levels: Record<string, string | undefined>,
): { adapter: ReturnType<typeof claudeAdapter>; asked: string[] } => {
  const asked: string[] = [];
  const adapter = claudeAdapter('/w', {
    configDir: nowhere,
    effort: (dir, id) => {
      asked.push(`${dir}:${id}`);
      return levels[id];
    },
  });
  return { adapter, asked };
};

test('message_start names the model; the effort is read when the turn ends', () => {
  const { adapter, asked } = withLevels({ 'sid-1': 'high' });
  expect(adapter.mapLine(init())).toEqual({ events: [], agentSessionId: 'sid-1' });
  // A fresh session: nothing has been read yet, so the spec is the model alone.
  expect(adapter.mapLine(messageStart('claude-fable-5-1'))?.spec).toEqual({
    model: 'claude-fable-5-1',
  });
  expect(asked).toEqual([]);
  // The turn's assistant line has been written by the time `result` arrives.
  expect(adapter.mapLine(result)).toMatchObject({
    turnEnded: true,
    spec: { model: 'claude-fable-5-1', effort: 'high' },
  });
  expect(asked).toEqual(['/private/tmp/w:sid-1']);
  // The next prompt's init and message_start carry the effort last read, without a read.
  expect(adapter.mapLine(init())?.spec).toBeUndefined();
  expect(adapter.mapLine(messageStart('claude-fable-5-1'))?.spec).toEqual({
    model: 'claude-fable-5-1',
    effort: 'high',
  });
  expect(asked).toEqual(['/private/tmp/w:sid-1']);
});

test('a read that finds no effort unsets it, and lines naming nothing carry no spec', () => {
  const levels: Record<string, string | undefined> = { 'sid-1': 'medium' };
  const { adapter } = withLevels(levels);
  adapter.mapLine(init());
  adapter.mapLine(messageStart('claude-fable-5'));
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5', effort: 'medium' });
  levels['sid-1'] = undefined;
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5' });
  expect(adapter.mapLine(start)?.spec).toBeUndefined();
  expect(adapter.mapLine(tokens(10))?.spec).toBeUndefined();
});

test('without a model there is no spec; without a transcript there is no read', () => {
  const { adapter, asked } = withLevels({ 'sid-1': 'high' });
  // A result before any model was named: nothing to restate.
  expect(adapter.mapLine(result)?.spec).toBeUndefined();
  // A model named before init: the model alone, and a turn end reads nothing.
  expect(adapter.mapLine(messageStart('claude-fable-5-1'))?.spec).toEqual({
    model: 'claude-fable-5-1',
  });
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5-1' });
  // An init that names no cwd (an older agent) leaves the transcript unknown too.
  expect(adapter.mapLine(init('sid-1', ''))?.spec).toBeUndefined();
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5-1' });
  expect(asked).toEqual([]);
  // One that does makes the next turn end read it.
  adapter.mapLine(init());
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5-1', effort: 'high' });
  expect(asked).toEqual(['/private/tmp/w:sid-1']);
});

test('a model change mid-session drops the effort on record until the next turn end', () => {
  const levels: Record<string, string | undefined> = { 'sid-1': 'high' };
  const { adapter } = withLevels(levels);
  adapter.mapLine(init());
  adapter.mapLine(messageStart('claude-fable-5'));
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5', effort: 'high' });
  // `/model haiku`: the next call names a model with no effort levels.
  expect(adapter.mapLine(messageStart('claude-haiku-4-5'))?.spec).toEqual({
    model: 'claude-haiku-4-5',
  });
  levels['sid-1'] = undefined;
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-haiku-4-5' });
  // The same model named again keeps what was read.
  levels['sid-1'] = 'low';
  adapter.mapLine(result);
  expect(adapter.mapLine(messageStart('claude-haiku-4-5'))?.spec).toEqual({
    model: 'claude-haiku-4-5',
    effort: 'low',
  });
});

test('reset forgets the model, the effort and the transcript, as the process is gone', () => {
  const { adapter, asked } = withLevels({ 'sid-1': 'high' });
  adapter.mapLine(init());
  adapter.mapLine(messageStart('claude-fable-5'));
  adapter.mapLine(result);
  adapter.reset();
  expect(adapter.mapLine(result)?.spec).toBeUndefined();
  expect(adapter.mapLine(messageStart('claude-fable-5'))?.spec).toEqual({
    model: 'claude-fable-5',
  });
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5' });
  expect(asked).toEqual(['/private/tmp/w:sid-1']);
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('by default the effort is read from the transcript under the config dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flux-claude-'));
  dirs.push(dir);
  const transcript = transcriptPath(cwd, 'sid-1', dir);
  mkdirSync(dirname(transcript), { recursive: true });
  copyFileSync(
    new URL('../../test/fixtures/claude/transcript-two-turns.jsonl', import.meta.url),
    transcript,
  );
  const adapter = claudeAdapter('/w', { configDir: dir });
  adapter.mapLine(init());
  expect(adapter.mapLine(messageStart('claude-fable-5'))?.spec).toEqual({
    model: 'claude-fable-5',
  });
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5', effort: 'high' });
});
