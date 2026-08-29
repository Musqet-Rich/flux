import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import type { PiExtensionApi } from './flux-pi-extension.ts';
import fluxPiExtension from './flux-pi-extension.ts';

// The extension registers the two Flux tools with pi and forwards each call over the control
// socket. The socket end is a tiny server here; the real one is create-control-socket.ts, and
// the wire it speaks is the one flux-mcp.ts uses (ADR 0008).

type Tool = Parameters<PiExtensionApi['registerTool']>[0];

const seen: unknown[] = [];
let server: Server | null = null;
const savedEnv = { ...process.env };

afterEach(() => {
  server?.close();
  server = null;
  seen.length = 0;
  process.env = { ...savedEnv };
});

// One line in, one line out; `reply` decides what the daemon says.
const listen = (reply: (request: unknown) => string): Promise<string> =>
  new Promise((resolve) => {
    const path = join(mkdtempSync(join(tmpdir(), 'flux-ext-')), 'c.sock');
    server = createServer((socket) => {
      // An aborted extension hangs up on us mid-request; that is expected, not a failure.
      socket.on('error', () => {});
      let buffer = '';
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const end = buffer.indexOf('\n');
        if (end === -1) return;
        const request: unknown = JSON.parse(buffer.slice(0, end));
        seen.push(request);
        const answer = reply(request);
        // An empty reply is a daemon that stays silent: the connection is left open.
        if (answer !== '') socket.end(answer);
      });
    });
    server.listen(path, () => {
      resolve(path);
    });
  });

const tools = (): Record<string, Tool> => {
  const registered: Record<string, Tool> = {};
  fluxPiExtension({
    registerTool: (definition) => {
      registered[definition.name] = definition;
    },
  });
  return registered;
};

test('registers flux_ask and flux_notify with JSON schemas pi can show the model', () => {
  const registered = tools();
  expect(Object.keys(registered)).toEqual(['flux_ask', 'flux_notify']);
  expect(registered['flux_ask']?.parameters).toMatchObject({
    type: 'object',
    required: ['question'],
  });
  expect(registered['flux_notify']?.parameters).toMatchObject({
    type: 'object',
    required: ['summary', 'level'],
  });
  expect(registered['flux_ask']?.promptGuidelines[0]).toContain('flux_ask');
});

test('flux_ask blocks on the daemon and returns the answer; flux_notify returns at once', async () => {
  // The daemon answers a notify with `{}`; the extension ignores the result either way.
  process.env['FLUX_CONTROL_SOCKET'] = await listen(
    () => `${JSON.stringify({ ok: true, result: { answer: 'blue' } })}\n`,
  );
  process.env['FLUX_SESSION'] = 's1';
  const registered = tools();
  const ask = await registered['flux_ask']?.execute('t1', {
    question: 'Red or blue?',
    options: ['red', 'blue'],
  });
  expect(ask).toEqual({ content: [{ type: 'text', text: 'blue' }], details: {} });
  const notify = await registered['flux_notify']?.execute('t2', { summary: 'done', level: 'done' });
  expect(notify).toEqual({ content: [{ type: 'text', text: 'noted' }], details: {} });
  const loose = await registered['flux_notify']?.execute('t3', { summary: 'hm', level: 'loud' });
  expect(loose).toEqual({ content: [{ type: 'text', text: 'noted' }], details: {} });
  expect(seen).toEqual([
    { type: 'ask', session: 's1', question: 'Red or blue?', options: ['red', 'blue'] },
    { type: 'notify', session: 's1', summary: 'done', level: 'done' },
    { type: 'notify', session: 's1', summary: 'hm', level: 'info' },
  ]);
});

test('bad arguments and daemon failures are thrown, which pi reports to the model as errors', async () => {
  process.env['FLUX_CONTROL_SOCKET'] = await listen(
    () => `${JSON.stringify({ ok: false, error: 'no such session' })}\n`,
  );
  const registered = tools();
  await expect(registered['flux_ask']?.execute('t', {})).rejects.toThrow('question is required');
  await expect(registered['flux_notify']?.execute('t', {})).rejects.toThrow('summary is required');
  await expect(registered['flux_ask']?.execute('t', { question: 'x' })).rejects.toThrow(
    'no such session',
  );
  process.env['FLUX_CONTROL_SOCKET'] = await listen(() => 'not json\n');
  await expect(tools()['flux_ask']?.execute('t', { question: 'x' })).rejects.toThrow(
    'unreadable reply',
  );
  process.env['FLUX_CONTROL_SOCKET'] = await listen(() => ' ');
  await expect(tools()['flux_ask']?.execute('t', { question: 'x' })).rejects.toThrow(
    'closed without replying',
  );
  process.env['FLUX_CONTROL_SOCKET'] = join(tmpdir(), 'flux-no-such.sock');
  await expect(tools()['flux_ask']?.execute('t', { question: 'x' })).rejects.toThrow('unreachable');
});

test('aborting the signal while flux_ask waits hangs up on the daemon and fails the call', async () => {
  // A daemon that never answers: the ask is settled only by the abort.
  process.env['FLUX_CONTROL_SOCKET'] = await listen(() => '');
  const controller = new AbortController();
  const registered = tools();
  const closed = new Promise<void>((resolve) => {
    server?.on('connection', (socket) => {
      socket.on('close', () => {
        resolve();
      });
    });
  });
  const waiting = registered['flux_ask']?.execute('t', { question: 'x' }, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toThrow('aborted by the operator');
  await closed;
});
