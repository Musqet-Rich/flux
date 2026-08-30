#!/usr/bin/env node
// A stand-in for the `claude` binary that replays a captured stream-json fixture: each user
// message on stdin plays the next turn (fixture lines up to and including a `result`), and
// end of stdin ends the process. Flags are accepted and ignored so the real spawn args work.
// FLUX_FAKE_FIXTURE names the fixture; FLUX_FAKE_EXIT_AFTER_TURNS makes it die early;
// FLUX_FAKE_ARGS_FILE records the spawn args for the spawn test.
// Node 24 runs this .ts directly (type stripping), so it needs no build step.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const argsFile = process.env['FLUX_FAKE_ARGS_FILE'];
if (argsFile !== undefined) writeFileSync(argsFile, JSON.stringify(process.argv.slice(2)));

const typeOf = (line: string): unknown => {
  const parsed: unknown = JSON.parse(line);
  return typeof parsed === 'object' && parsed !== null && 'type' in parsed ? parsed.type : null;
};

const fixture = process.env['FLUX_FAKE_FIXTURE'];
if (fixture === undefined) {
  process.stderr.write('FLUX_FAKE_FIXTURE is required\n');
  process.exit(2);
}
const lines = readFileSync(fixture, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');
const turns: string[][] = [];
let current: string[] = [];
for (const line of lines) {
  current.push(line);
  if (typeOf(line) === 'result') {
    turns.push(current);
    current = [];
  }
}
const exitAfter = Number(process.env['FLUX_FAKE_EXIT_AFTER_TURNS'] ?? Number.POSITIVE_INFINITY);
let played = 0;

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (line.trim() === '' || typeOf(line) !== 'user') return;
  const turn = turns[played % turns.length] ?? [];
  played += 1;
  process.stdout.write(`${turn.join('\n')}\n`);
  if (played >= exitAfter) process.exit(1);
});
input.on('close', () => {
  process.exit(0);
});
