import { mkdtemp } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, expect, test } from 'vitest';

import type { ControlRequest, ControlSocket } from './create-control-socket.ts';
import { createControlSocket } from './create-control-socket.ts';

let path: string;
let socket: ControlSocket;
let seen: ControlRequest[];
let signals: AbortSignal[];

beforeEach(async () => {
  path = join(await mkdtemp(join(tmpdir(), 'flux-ctl-')), 'control.sock');
  seen = [];
  signals = [];
  socket = createControlSocket({
    path,
    handle: (request, signal) => {
      seen.push(request);
      signals.push(signal);
      if (request.type === 'ask') return Promise.resolve({ answer: `re: ${request.question}` });
      if (request.type === 'pair') return Promise.reject(new Error('no daemon'));
      return Promise.resolve({});
    },
  });
  await socket.listen();
});

afterEach(async () => {
  await socket.close();
});

// Opens a client, sends one line per request, resolves with the reply lines in order.
const roundTrip = (lines: string[]): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const client = connect(path);
    const replies: string[] = [];
    client.on('error', reject);
    createInterface({ input: client }).on('line', (line) => {
      replies.push(line);
      if (replies.length === lines.length) {
        client.end();
        resolve(replies);
      }
    });
    client.on('connect', () => {
      for (const line of lines) client.write(`${line}\n`);
    });
  });

const parse = (line: string): unknown => JSON.parse(line);

test('handles ask, notify and pair requests and reports handler errors', async () => {
  const replies = await roundTrip([
    JSON.stringify({ type: 'ask', session: 's', question: 'deploy?', options: ['y', 'n'] }),
    JSON.stringify({ type: 'notify', session: 's', summary: 'done', level: 'done' }),
    JSON.stringify({ type: 'pair' }),
  ]);
  expect(replies.map((r) => parse(r))).toEqual([
    { ok: true, result: { answer: 're: deploy?' } },
    { ok: true, result: {} },
    { ok: false, error: 'no daemon' },
  ]);
  expect(seen).toHaveLength(3);
});

test('rejects malformed lines without dropping the connection', async () => {
  const replies = await roundTrip([
    'not json',
    JSON.stringify({ type: 'ask', session: 's' }),
    JSON.stringify({ type: 'notify', session: 's', summary: 'x', level: 'loud' }),
    JSON.stringify({ type: 'other' }),
    JSON.stringify({ type: 'notify', session: 's', summary: 'x', level: 'info' }),
  ]);
  expect(replies.map((r) => parse(r))).toEqual([
    { ok: false, error: 'bad request' },
    { ok: false, error: 'bad request' },
    { ok: false, error: 'bad request' },
    { ok: false, error: 'bad request' },
    { ok: true, result: {} },
  ]);
  expect(seen).toHaveLength(1);
});

test('a stale socket file is replaced on listen', async () => {
  await socket.close();
  const again = createControlSocket({ path, handle: () => Promise.resolve({}) });
  await again.listen();
  expect(await roundTrip([JSON.stringify({ type: 'pair' })])).toEqual(['{"ok":true,"result":{}}']);
  await again.close();
  socket = createControlSocket({ path, handle: () => Promise.resolve({}) });
  await socket.listen();
});

const untilSignal = (): Promise<AbortSignal> =>
  new Promise((resolve) => {
    const check = (): void => {
      const first = signals[0];
      if (first === undefined) setImmediate(check);
      else resolve(first);
    };
    check();
  });

test('a client that hangs up mid-request aborts the handler signal', async () => {
  const client = connect(path);
  // The reply lands on a destroyed socket; that is the point, not a failure.
  client.on('error', () => {});
  await new Promise<void>((resolve) => {
    client.on('connect', resolve);
  });
  client.write(`${JSON.stringify({ type: 'ask', session: 's', question: 'still there?' })}\n`);
  const signal = await untilSignal();
  const aborted = new Promise<void>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
  client.destroy();
  await aborted;
  expect(signal.aborted).toBe(true);
});
