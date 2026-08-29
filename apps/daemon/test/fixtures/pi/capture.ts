#!/usr/bin/env node
// Captures raw `pi --mode rpc` stdout into fixture files (see README.md).
//   node capture.ts <scenario> <outDir>
// Spawns pi the way the daemon does, plays a fake control socket for the Flux tools, and writes
// <scenario>.jsonl (stdout as emitted), <scenario>.stderr.txt and <scenario>.meta.json.
// Real pi, real provider, real money: keep the prompts small.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [scenario = '', outDir = ''] = process.argv.slice(2);
const pi = process.env['FLUX_PI'] ?? 'pi';
const extension = fileURLToPath(new URL('../../../src/pi/flux-pi-extension.ts', import.meta.url));
const work = process.env['FLUX_CAPTURE_DIR'] ?? mkdtempSync(join(tmpdir(), 'flux-pi-capture-'));
const sessionDir = join(work, 'sessions');
const cwd = join(work, 'work');
mkdirSync(cwd, { recursive: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(cwd, 'notes.txt'), 'The secret word is marmalade.\n');

// Unix socket paths are limited to ~100 bytes, so it lives in /tmp regardless of `work`.
const socket = `/tmp/flux-pi-capture-${process.pid}.sock`;
const server = createServer((client) => {
  let buffer = '';
  client.on('data', (chunk) => {
    buffer += chunk.toString();
    const end = buffer.indexOf('\n');
    if (end === -1) return;
    const request = JSON.parse(buffer.slice(0, end)) as { type: string };
    console.error('control:', buffer.slice(0, end));
    const result = request.type === 'ask' ? { answer: 'blue' } : {};
    client.end(`${JSON.stringify({ ok: true, result })}\n`);
  });
});
server.listen(socket);

interface Scenario {
  args: string[];
  prompt: string;
  sessionId: string;
  abortOnDelta?: boolean;
}

const scenarios: Record<string, Scenario> = {
  'text-reply': {
    args: [],
    prompt: 'Reply with exactly the word: pong',
    sessionId: '11111111-1111-4111-8111-111111111111',
  },
  tools: {
    args: [],
    prompt:
      'Read notes.txt in the current directory, then run `ls` with bash. Then reply in one short sentence with what you found.',
    sessionId: '22222222-2222-4222-8222-222222222222',
  },
  'flux-tools': {
    args: [],
    prompt:
      "Call flux_notify with summary 'starting' and level 'info'. Then call flux_ask with question 'Red or blue?' and options ['red','blue']. Reply with just the answer you received.",
    sessionId: '33333333-3333-4333-8333-333333333333',
  },
  interrupt: {
    args: [],
    prompt: 'Write the numbers from 1 to 300, one per line, and nothing else.',
    sessionId: '44444444-4444-4444-8444-444444444444',
    abortOnDelta: true,
  },
  resume: {
    args: [],
    prompt:
      'What single word did you reply with earlier in this conversation? Answer with just that word.',
    sessionId: '11111111-1111-4111-8111-111111111111',
  },
  'bad-model': {
    args: ['--model', 'no-such-model'],
    prompt: 'hi',
    sessionId: '55555555-5555-4555-8555-555555555555',
  },
};

const chosen = scenarios[scenario];
if (chosen === undefined) {
  console.error(`usage: capture.ts <${Object.keys(scenarios).join('|')}> <outDir>`);
  process.exit(2);
}

const fluxPrompt =
  'You are running unattended under Flux. The operator is on a phone. For any material decision ' +
  '(design choices, destructive actions, ambiguous requirements) call flux_ask instead of guessing; ' +
  'call flux_notify with level "done" when the task is complete and "blocked" when you cannot proceed.';

const args = [
  '--mode',
  'rpc',
  '--provider',
  process.env['FLUX_PI_PROVIDER'] ?? 'anthropic',
  '--model',
  process.env['FLUX_PI_MODEL'] ?? 'claude-haiku-4-5',
  '--session-dir',
  sessionDir,
  '--session-id',
  chosen.sessionId,
  '--no-approve',
  // Signed thinking blocks are opaque base64 the secret scanner refuses; the daemon itself
  // leaves thinking to pi's settings, and the parser skips thinking events either way.
  '--thinking',
  'off',
  '--extension',
  extension,
  '--append-system-prompt',
  fluxPrompt,
  ...chosen.args,
];
console.error('pi', args.join(' '));
const child = spawn(pi, args, {
  cwd,
  env: { ...process.env, FLUX_CONTROL_SOCKET: socket, FLUX_SESSION: 'fixture' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const out = createWriteStream(join(outDir, `${scenario}.jsonl`));
child.stderr.pipe(createWriteStream(join(outDir, `${scenario}.stderr.txt`)));

let buffer = '';
let aborted = false;
child.stdout.on('data', (chunk: Buffer) => {
  out.write(chunk);
  buffer += chunk.toString();
  let end = buffer.indexOf('\n');
  while (end !== -1) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    end = buffer.indexOf('\n');
    const event = JSON.parse(line) as {
      type: string;
      command?: string;
      success?: boolean;
      assistantMessageEvent?: { type: string };
    };
    console.error('<', event.type, event.assistantMessageEvent?.type ?? event.command ?? '');
    const delta =
      event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta';
    if (chosen.abortOnDelta === true && !aborted && delta) {
      aborted = true;
      child.stdin.write(`${JSON.stringify({ type: 'abort' })}\n`);
    }
    const rejected =
      event.type === 'response' && event.command === 'prompt' && event.success === false;
    if (event.type === 'agent_settled' || rejected) setTimeout(() => child.stdin.end(), 500);
  }
});
child.on('exit', (code, signal) => {
  const meta = { code, signal, args: args.filter((a) => !a.startsWith('/')) };
  writeFileSync(join(outDir, `${scenario}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
  console.error('exit', code, signal);
  server.close();
  process.exit(0);
});
setTimeout(() => {
  console.error('timeout, killing');
  child.kill('SIGKILL');
}, 180_000);
child.stdin.write(`${JSON.stringify({ type: 'prompt', message: chosen.prompt })}\n`);
