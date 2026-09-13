import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const captured = new URL('../../test/fixtures/claude/effort-set.jsonl', import.meta.url);
const captureSession = '4ac9415b-8e19-48a8-b7ab-d92d52545e4e';
// Every spec the adapter gives across the capture; `beforeLast` runs before its final line.
const replay = (
  adapter: ReturnType<typeof claudeAdapter>,
  beforeLast: () => void,
): { specs: unknown[]; chosen: unknown[] } => {
  const lines = readFileSync(captured, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const specs: unknown[] = [];
  const chosen: unknown[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === lines.length - 1) beforeLast();
    const mapped = adapter.mapLine(line);
    if (mapped?.spec !== undefined) specs.push(mapped.spec);
    if (mapped?.chosen !== undefined) chosen.push(mapped.chosen);
  }
  return { specs, chosen };
};

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

// The operator's `/effort <level>` (ADR 0031): Claude confirms it on a synthetic assistant line
// and writes no assistant line to the transcript, so the level is taken from the confirmation,
// its own turn's end reads nothing, and the next real turn's end reads as ever.
const effortSet = (level: string, parent?: string): string =>
  JSON.stringify({
    type: 'assistant',
    ...(parent === undefined ? {} : { parent_tool_use_id: parent }),
    message: {
      model: '<synthetic>',
      content: [{ type: 'text', text: `Set effort level to ${level} (this session only): …` }],
    },
  });

const spoke = JSON.stringify({
  type: 'assistant',
  message: { model: 'claude-fable-5', content: [{ type: 'text', text: 'ok' }] },
});
const failed = JSON.stringify({ type: 'result', subtype: 'error', is_error: true });
// A local command's reply that sets no level (`/effort` alone, `/status`): no line written.
const usage = JSON.stringify({
  type: 'assistant',
  message: { model: '<synthetic>', content: [{ type: 'text', text: 'Usage: /effort <level>' }] },
});

test('an effort the operator set is the spec at once, kept, and not re-read at its turn end', () => {
  const levels: Record<string, string | undefined> = { 'sid-1': 'high' };
  const { adapter, asked } = withLevels(levels);
  adapter.mapLine(init());
  adapter.mapLine(messageStart('claude-fable-5'));
  adapter.mapLine(result);
  expect(adapter.mapLine(effortSet('medium'))).toEqual({
    events: [{ type: 'msg.assistant', payload: { text: expect.stringContaining('medium') } }],
    chosen: { effort: 'medium' },
    spec: { model: 'claude-fable-5', effort: 'medium' },
  });
  // The command's own turn ends without a read: the transcript still says high.
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5', effort: 'medium' });
  expect(asked).toEqual(['/private/tmp/w:sid-1']);
  // The next real turn's end reads, and the transcript has caught up.
  levels['sid-1'] = 'medium';
  adapter.mapLine(messageStart('claude-fable-5'));
  adapter.mapLine(spoke);
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5', effort: 'medium' });
  expect(asked).toEqual(['/private/tmp/w:sid-1', '/private/tmp/w:sid-1']);
});

test('a level the --effort flag refuses runs here but is not kept; before a model, no spec', () => {
  const { adapter } = withLevels({ 'sid-1': 'high' });
  // The first message of a fresh process: nothing has named the model yet.
  expect(adapter.mapLine(effortSet('medium'))).toEqual({
    events: [{ type: 'msg.assistant', payload: { text: expect.stringContaining('medium') } }],
    chosen: { effort: 'medium' },
  });
  adapter.mapLine(result);
  adapter.mapLine(init());
  expect(adapter.mapLine(messageStart('claude-fable-5'))?.spec).toEqual({
    model: 'claude-fable-5',
    effort: 'medium',
  });
  const ultra = adapter.mapLine(effortSet('ultracode'));
  expect(ultra?.spec).toEqual({ model: 'claude-fable-5', effort: 'ultracode' });
  expect(ultra?.chosen).toBeUndefined();
});

test('the word stands through local commands and cut calls, until a message is written', () => {
  const levels: Record<string, string | undefined> = { 'sid-1': 'high' };
  const { adapter, asked } = withLevels(levels);
  adapter.mapLine(init());
  adapter.mapLine(effortSet('medium'));
  adapter.mapLine(result);
  // Another local command (`/effort` alone, `/status`, `/compact`): a turn end with no line.
  expect(adapter.mapLine(usage)?.spec).toBeUndefined();
  adapter.mapLine(result);
  // A call that fails or is stopped before a message: no line either.
  expect(adapter.mapLine(messageStart('claude-fable-5'))?.spec).toEqual({
    model: 'claude-fable-5',
    effort: 'medium',
  });
  expect(adapter.mapLine(failed)?.spec).toEqual({ model: 'claude-fable-5', effort: 'medium' });
  expect(asked).toEqual([]);
  // A message completed is the line written; its turn end reads.
  levels['sid-1'] = 'medium';
  adapter.mapLine(messageStart('claude-fable-5'));
  adapter.mapLine(spoke);
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5', effort: 'medium' });
  expect(asked).toEqual(['/private/tmp/w:sid-1']);
  // Gone with the process, like the rest.
  adapter.mapLine(effortSet('low'));
  adapter.reset();
  adapter.mapLine(init());
  adapter.mapLine(messageStart('claude-fable-5'));
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-fable-5', effort: 'medium' });
});

// The captured session (fixtures/claude/effort-set): a turn, `/effort` medium, auto, ultracode
// and a refused word, a turn. The stub transcript says what the real one did: high after the
// first turn, xhigh (ultracode's own level) after the last. Only medium is kept.
test('the captured sequence: the chip says each word set, the record keeps the one kept', () => {
  const levels: Record<string, string | undefined> = { [captureSession]: 'high' };
  const { adapter, asked } = withLevels(levels);
  const { specs, chosen } = replay(adapter, () => {
    levels[captureSession] = 'xhigh';
  });
  expect(chosen).toEqual([{ effort: 'medium' }]);
  const model = 'claude-fable-5-1';
  expect(specs).toEqual([
    { model },
    { model, effort: 'high' },
    { model, effort: 'medium' },
    { model, effort: 'medium' },
    { model, effort: 'auto' },
    { model, effort: 'auto' },
    { model, effort: 'ultracode' },
    { model, effort: 'ultracode' },
    { model, effort: 'ultracode' },
    { model, effort: 'ultracode' },
    { model, effort: 'xhigh' },
  ]);
  expect(asked).toHaveLength(2);
});

test('a model change after the word drops it, and the next turn end reads', () => {
  const levels: Record<string, string | undefined> = { 'sid-1': 'high' };
  const { adapter, asked } = withLevels(levels);
  adapter.mapLine(init());
  adapter.mapLine(messageStart('claude-fable-5'));
  adapter.mapLine(result);
  adapter.mapLine(effortSet('medium'));
  // `/model opus` before the command's own turn ended: the level was the old model's.
  expect(adapter.mapLine(messageStart('claude-opus-5'))?.spec).toEqual({ model: 'claude-opus-5' });
  levels['sid-1'] = 'low';
  expect(adapter.mapLine(result)?.spec).toEqual({ model: 'claude-opus-5', effort: 'low' });
  expect(asked).toHaveLength(2);
  // The word after the change is that model's.
  expect(adapter.mapLine(effortSet('xhigh'))?.spec).toEqual({
    model: 'claude-opus-5',
    effort: 'xhigh',
  });
});

test('a subagent printing the line is not the operator', () => {
  const { adapter } = withLevels({ 'sid-1': 'high' });
  adapter.mapLine(init());
  adapter.mapLine(messageStart('claude-fable-5'));
  const parented = adapter.mapLine(effortSet('medium', 'tu-1'));
  expect(parented?.chosen).toBeUndefined();
  expect(parented?.spec).toBeUndefined();
  expect(parented?.events[0]).toMatchObject({ type: 'msg.assistant', parent: 'tu-1' });
});
