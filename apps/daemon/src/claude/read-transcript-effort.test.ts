import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

import { readTranscriptEffort } from './read-transcript-effort.ts';

// The line shape is the captured transcript's (fixtures/claude/transcript-two-turns, Claude Code
// 2.1.251: six top-level assistant lines, each with `effort`). The other files here are built
// in the test to exercise the read itself — what is skipped, where a chunk boundary falls, the
// bound — with lines that keep only the keys the reader looks at; a fresh capture is not used
// for those because a 2.1.269 transcript carries the operator's account details in its
// `session_context` attachment. The capture has `isSidechain` only as `false`: that a
// subagent's line says `true` is known from the agent's transcripts, not captured here.
const captured = new URL('../../test/fixtures/claude/transcript-two-turns.jsonl', import.meta.url);

const assistant = (extra: Record<string, unknown>): string =>
  JSON.stringify({ isSidechain: false, type: 'assistant', ...extra });
const user = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } });
const other = (bytes: number): string =>
  JSON.stringify({ type: 'attachment', pad: 'x'.repeat(bytes) });

const dirs: string[] = [];
const transcript = (lines: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flux-transcript-'));
  dirs.push(dir);
  const path = join(dir, 't.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('the captured transcript reads as the effort on its newest assistant line', () => {
  expect(readTranscriptEffort(fileURLToPath(captured))).toBe('high');
  // Every assistant line in the capture says so, in case the newest one is ever the odd one.
  const lines = readFileSync(captured, 'utf8').split('\n');
  const efforts = lines
    .filter((l) => l.includes('"type":"assistant"'))
    .map((l): unknown => JSON.parse(l))
    .map((l) => (l as { effort?: unknown }).effort);
  expect(efforts).toEqual(['high', 'high', 'high', 'high', 'high', 'high']);
});

test('the newest top-level assistant line wins; a subagent line is skipped', () => {
  const path = transcript([
    user,
    assistant({ effort: 'low' }),
    user,
    assistant({ effort: 'high', isSidechain: true }),
    assistant({ effort: 'medium' }),
    other(10),
  ]);
  expect(readTranscriptEffort(path)).toBe('medium');
});

test('an assistant line without an effort reads as unknown, not as the older line', () => {
  expect(
    readTranscriptEffort(transcript([user, assistant({ effort: 'high' }), assistant({})])),
  ).toBe(undefined);
  expect(readTranscriptEffort(transcript([user, assistant({ effort: '' })]))).toBe(undefined);
});

test('no file, no assistant line, or a broken line all read as unknown', () => {
  expect(readTranscriptEffort('/nowhere/at/all.jsonl')).toBe(undefined);
  expect(readTranscriptEffort(transcript([user, other(10)]))).toBe(undefined);
  expect(readTranscriptEffort(transcript(['{"type":"assistant"', user]))).toBe(undefined);
  expect(readTranscriptEffort(transcript([]))).toBe(undefined);
});

test('the read walks back through lines larger than one chunk to the assistant line', () => {
  expect(
    readTranscriptEffort(transcript([assistant({ effort: 'xhigh' }), other(200 * 1024)])),
  ).toBe('xhigh');
  // An assistant line cut by a chunk boundary is completed by the next chunk before it is read.
  const straddling = transcript([
    user,
    assistant({ effort: 'max', pad: 'y'.repeat(70 * 1024) }),
    other(30 * 1024),
  ]);
  expect(readTranscriptEffort(straddling)).toBe('max');
  // A line longer than several chunks, with the answer before it.
  const long = transcript([assistant({ effort: 'low' }), other(3 * 64 * 1024 + 100)]);
  expect(readTranscriptEffort(long)).toBe('low');
  // The answer on the file's first line, reached at the file's start with no newline before it.
  expect(readTranscriptEffort(transcript([assistant({ effort: 'medium' })]))).toBe('medium');
});

test('the read gives up at its bound rather than scanning a huge file', () => {
  const path = transcript([assistant({ effort: 'high' }), other(4 * 1024 * 1024 + 1024)]);
  expect(readTranscriptEffort(path)).toBe(undefined);
});
