#!/usr/bin/env node
// A stand-in for the `pi` binary in `--mode rpc` that replays captured fixtures: each `prompt`
// command on stdin plays the next run (one fixture file, from its `response` line to
// `agent_settled`), and end of stdin ends the process. Flags are accepted and ignored so the
// real spawn args work; FLUX_FAKE_ARGS_FILE records them for the spawn test.
// FLUX_FAKE_FIXTURE lists the fixture files, comma separated, played in order and cycled.
// A run whose fixture carries an `abort` response pauses at its first `message_update` until an
// `abort` command arrives, the way the real run only stopped when told to. FLUX_FAKE_EXIT_AFTER_TURNS
// makes the process die early. FLUX_FAKE_STDERR_FILE is written to stderr at start, the way pi
// prints warnings and auth failures. FLUX_FAKE_UI_REQUEST=1 opens a dialog before each run and
// plays the run only once the client has answered it.
// Node 24 runs this .ts directly (type stripping), so it needs no build step.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const typeOf = (line: string): unknown => {
  const parsed: unknown = JSON.parse(line);
  return typeof parsed === 'object' && parsed !== null && 'type' in parsed ? parsed.type : null;
};

const fixture = process.env['FLUX_FAKE_FIXTURE'];
if (fixture === undefined) {
  process.stderr.write('FLUX_FAKE_FIXTURE is required\n');
  process.exit(2);
}
const stderrFile = process.env['FLUX_FAKE_STDERR_FILE'];
if (stderrFile !== undefined) process.stderr.write(readFileSync(stderrFile, 'utf8'));
const uiRequest = process.env['FLUX_FAKE_UI_REQUEST'] === '1';
const argsFile = process.env['FLUX_FAKE_ARGS_FILE'];
if (argsFile !== undefined) writeFileSync(argsFile, JSON.stringify(process.argv.slice(2)));

const runs = fixture.split(',').map((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== ''),
);
const commandOf = (line: string): unknown => {
  const parsed: unknown = JSON.parse(line);
  return typeof parsed === 'object' && parsed !== null && 'command' in parsed
    ? parsed.command
    : null;
};
const waitsForAbort = (run: string[]): boolean => run.some((line) => commandOf(line) === 'abort');
const exitAfter = Number(process.env['FLUX_FAKE_EXIT_AFTER_TURNS'] ?? Number.POSITIVE_INFINITY);
let played = 0;
let paused: string[] | null = null;
let awaitingDialog: string[] | null = null;
// An abort that arrives before the run reaches its pause point still counts.
let abortEarly = false;

const play = (lines: string[], pausable: boolean): void => {
  const rest = [...lines];
  while (rest.length > 0) {
    const line = rest.shift() ?? '';
    process.stdout.write(`${line}\n`);
    if (pausable && !abortEarly && typeOf(line) === 'message_update') {
      paused = rest;
      return;
    }
  }
  if (played >= exitAfter) process.exit(1);
};

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (line.trim() === '') return;
  const type = typeOf(line);
  if (type === 'abort') {
    if (paused === null) {
      abortEarly = true;
      return;
    }
    const rest = paused;
    paused = null;
    play(rest, false);
  } else if (type === 'prompt') {
    const run = runs[played % runs.length] ?? [];
    played += 1;
    abortEarly = false;
    if (uiRequest) {
      awaitingDialog = run;
      const request = { type: 'extension_ui_request', id: 'u1', method: 'confirm', title: 'Go?' };
      process.stdout.write(`${JSON.stringify(request)}\n`);
    } else play(run, waitsForAbort(run));
  } else if (type === 'extension_ui_response' && awaitingDialog !== null) {
    const run = awaitingDialog;
    awaitingDialog = null;
    process.stdout.write(
      `${JSON.stringify({ type: 'response', command: 'extension_ui_response', success: true, data: JSON.parse(line) })}\n`,
    );
    play(run, waitsForAbort(run));
  }
});
input.on('close', () => {
  process.exit(0);
});
