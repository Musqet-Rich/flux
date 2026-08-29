#!/usr/bin/env node
import { guards } from '@flux/protocol';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

import { DaemonError } from './daemon-error.ts';

// The Flux MCP server (ADR 0008): a stdio JSON-RPC 2.0 server exposing flux_ask and
// flux_notify to the agent, forwarding each call to the daemon over the control socket.
// Spawned by the agent per session with FLUX_CONTROL_SOCKET and FLUX_SESSION in its env.

const { isString, isRecord, isArrayOf, isOneOf } = guards;

const socketPath = process.env['FLUX_CONTROL_SOCKET'] ?? '';
const session = process.env['FLUX_SESSION'] ?? '';

const tools = [
  {
    name: 'flux_ask',
    description:
      'Ask the operator a question and wait for the answer. Use it for any material decision instead of guessing. Returns the answer text, or an empty string if nobody answered in time.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question, with enough context to answer from a phone.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional short answers to offer.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'flux_notify',
    description:
      'Tell the operator something without waiting: progress (info), that the task is finished (done), or that you are stuck (blocked).',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One or two sentences.' },
        level: { type: 'string', enum: ['info', 'done', 'blocked'] },
      },
      required: ['summary', 'level'],
    },
  },
];

// One connection per call: the socket is local and calls are rare.
const control = (request: Record<string, unknown>): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const client = connect(socketPath);
    client.on('error', reject);
    createInterface({ input: client }).once('line', (line) => {
      client.end();
      const reply: unknown = JSON.parse(line);
      if (isRecord(reply) && reply['ok'] === true) resolve(reply['result']);
      else
        reject(
          new DaemonError(
            'internal',
            isRecord(reply) && isString(reply['error']) ? reply['error'] : 'bad reply',
          ),
        );
    });
    client.on('connect', () => {
      client.write(`${JSON.stringify(request)}\n`);
    });
  });

const callTool = async (name: unknown, args: unknown): Promise<string> => {
  const input = isRecord(args) ? args : {};
  if (name === 'flux_ask' && isString(input['question'])) {
    const options = isArrayOf(input['options'], isString) ? { options: input['options'] } : {};
    const result = await control({ type: 'ask', session, question: input['question'], ...options });
    return isRecord(result) && isString(result['answer']) ? result['answer'] : '';
  }
  if (name === 'flux_notify' && isString(input['summary'])) {
    const level = isOneOf(input['level'], ['info', 'done', 'blocked']) ? input['level'] : 'info';
    await control({ type: 'notify', session, summary: input['summary'], level });
    return 'noted';
  }
  throw new DaemonError('bad_params', `unknown tool ${String(name)}`);
};

const respond = (id: unknown, body: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`);
};

const simple: Record<string, () => unknown> = {
  initialize: () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'flux', version: '1' },
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools }),
};

const handle = async (message: Record<string, unknown>): Promise<void> => {
  const id = message['id'];
  const method = message['method'];
  const params = isRecord(message['params']) ? message['params'] : {};
  if (method === 'tools/call') {
    try {
      const text = await callTool(params['name'], params['arguments']);
      respond(id, { result: { content: [{ type: 'text', text }] } });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      respond(id, { result: { content: [{ type: 'text', text }], isError: true } });
    }
    return;
  }
  const answer = isString(method) ? simple[method] : undefined;
  if (answer !== undefined) respond(id, { result: answer() });
  // Notifications (no id) are silently accepted; unknown requests get the standard error.
  else if (id !== undefined) respond(id, { error: { code: -32601, message: 'method not found' } });
};

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (isRecord(message)) void handle(message);
});
