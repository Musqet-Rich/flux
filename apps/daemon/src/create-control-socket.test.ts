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

test('accepts valid compact requests, with and without focus', async () => {
  const replies = await roundTrip([
    JSON.stringify({ type: 'compact', session: 's' }),
    JSON.stringify({ type: 'compact', session: 's', focus: 'keep the shape' }),
  ]);
  expect(replies.map((r) => parse(r))).toEqual([
    { ok: true, result: {} },
    { ok: true, result: {} },
  ]);
  expect(seen).toEqual([
    { type: 'compact', session: 's' },
    { type: 'compact', session: 's', focus: 'keep the shape' },
  ]);
});

test('rejects a compact request with a blank/missing session or non-string focus', async () => {
  const replies = await roundTrip([
    JSON.stringify({ type: 'compact', session: '' }),
    JSON.stringify({ type: 'compact' }),
    JSON.stringify({ type: 'compact', session: 's', focus: '' }),
    JSON.stringify({ type: 'compact', session: 's', focus: 7 }),
  ]);
  expect(replies.map((r) => parse(r))).toEqual([
    { ok: false, error: 'bad request' },
    { ok: false, error: 'bad request' },
    { ok: false, error: 'bad request' },
    { ok: false, error: 'bad request' },
  ]);
  expect(seen).toHaveLength(0);
});

test('accepts the manager verbs with valid shapes (ADR 0025)', async () => {
  const requests = [
    { type: 'sessions.list', session: 'm' },
    { type: 'session.open', session: 'm', repo: '/r', branch: 'b', harness: 'claude' },
    {
      type: 'session.open',
      session: 'm',
      repo: '/r',
      branch: 'b',
      harness: 'pi',
      agent: 'a',
      title: '',
    },
    { type: 'session.open', session: 'm', repo: '/r', branch: 'b', harness: 'opencode' },
    { type: 'session.send', session: 'm', target: 's2', text: 'hi' },
    { type: 'session.close', session: 'm', target: 's2' },
    { type: 'session.read', session: 'm', target: 's2', limit: 5 },
  ];
  const replies = await roundTrip(requests.map((r) => JSON.stringify(r)));
  expect(replies.map((r) => parse(r))).toEqual(requests.map(() => ({ ok: true, result: {} })));
  expect(seen).toHaveLength(7);
});

test('rejects manager verbs with a blank/missing session or target or wrong harness', async () => {
  const replies = await roundTrip([
    JSON.stringify({ type: 'sessions.list', session: '' }),
    JSON.stringify({ type: 'session.open', session: 'm', repo: '/r', branch: 'b', harness: 'gpt' }),
    JSON.stringify({
      type: 'session.open',
      session: 'm',
      repo: '',
      branch: 'b',
      harness: 'claude',
    }),
    JSON.stringify({ type: 'session.send', session: 'm', target: '', text: 'hi' }),
    JSON.stringify({ type: 'session.send', session: 'm', target: 's2' }),
    JSON.stringify({ type: 'session.close', target: 's2' }),
    JSON.stringify({ type: 'session.read', session: 'm', target: 's2', limit: 0 }),
  ]);
  expect(replies.map((r) => parse(r))).toEqual(
    replies.map(() => ({ ok: false, error: 'bad request' })),
  );
  expect(seen).toHaveLength(0);
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

// A connection still open at close is an agent waiting for an answer that will not come;
// waiting for it to hang up would hold the daemon's shutdown.
// `close()` resolving is the proof: with the ask connection still open, `server.close` alone
// would wait for it for ever, so a resolved close is a destroyed connection.
test('close destroys open connections instead of waiting for them', async () => {
  const client = connect(path);
  client.on('error', () => {});
  await new Promise<void>((resolve) => {
    client.on('connect', resolve);
  });
  client.write(`${JSON.stringify({ type: 'ask', session: 's', question: 'anyone?' })}\n`);
  await untilSignal();
  await socket.close();
  socket = createControlSocket({ path, handle: () => Promise.resolve({}) });
  await socket.listen();
  expect(await roundTrip([JSON.stringify({ type: 'pair' })])).toEqual(['{"ok":true,"result":{}}']);
});
