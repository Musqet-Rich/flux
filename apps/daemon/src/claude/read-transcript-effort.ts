import { guards } from '@flux/protocol';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

// Claude Code names the model it runs on its stream but never the effort: that is written only
// to the transcript it keeps on disk (transcript-path.ts), where every top-level `assistant`
// line carries `effort` (fixtures/claude/transcript-two-turns, 2.1.251; still so on 2.1.269,
// where a model with no effort levels, Haiku 4.5, writes none). ADR 0028.
//
// The newest assistant line is the current effort. The file grows to megabytes, and each
// assistant line is followed by prompt snapshots of comparable size, so it is read backwards a
// chunk at a time up to a bound, each byte decoded once (a line cut by a chunk boundary is
// carried into the next). Anything unexpected reads as unknown: no file yet (the first turn of a
// fresh session), no assistant line within the bound, a model that reports none.

const { isRecord, isString } = guards;

const chunkBytes = 64 * 1024;
const maxBytes = 4 * 1024 * 1024;
const newline = 10;

// `found` distinguishes an assistant line with no effort (the answer is "none") from no
// assistant line yet (keep reading).
interface Scan {
  found: boolean;
  effort?: string;
}

const scanLine = (line: string): Scan | null => {
  if (!line.includes('"assistant"')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['type'] !== 'assistant' || parsed['isSidechain'] === true) {
    return null;
  }
  const effort = parsed['effort'];
  return isString(effort) && effort !== '' ? { found: true, effort } : { found: true };
};

// Whole lines only, newest first.
const scanLines = (bytes: Buffer): Scan | null => {
  for (const line of bytes.toString('utf8').split('\n').toReversed()) {
    const scan = scanLine(line);
    if (scan !== null) return scan;
  }
  return null;
};

const readBackwards = (fd: number): string | undefined => {
  const size = fstatSync(fd).size;
  // The head of a line the next chunk continues, as the chunks that hold it (file order), so a
  // line longer than a chunk is joined once when its start is found rather than on every chunk.
  let head: Buffer[] = [];
  let end = size;
  while (end > 0 && size - end < maxBytes) {
    const start = Math.max(0, end - chunkBytes);
    const chunk = Buffer.alloc(end - start);
    readSync(fd, chunk, 0, chunk.length, start);
    end = start;
    const cut = end === 0 ? -1 : chunk.indexOf(newline);
    if (cut === -1 && end !== 0) {
      head.unshift(chunk);
      continue;
    }
    const whole = Buffer.concat([end === 0 ? chunk : chunk.subarray(cut + 1), ...head]);
    head = end === 0 ? [] : [chunk.subarray(0, cut)];
    const scan = scanLines(whole);
    if (scan !== null) return scan.effort;
  }
  return undefined;
};

export const readTranscriptEffort = (path: string): string | undefined => {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return undefined;
  }
  try {
    return readBackwards(fd);
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
};
