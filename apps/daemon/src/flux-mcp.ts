#!/usr/bin/env node
import { guards } from '@flux/protocol';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

import { DaemonError } from './daemon-error.ts';

// The Flux MCP server (ADR 0008): a stdio JSON-RPC 2.0 server exposing flux_ask, flux_notify and
// flux_compact to the agent, forwarding each call to the daemon over the control socket.
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
  {
    name: 'flux_compact',
    description:
      'Compact your own context at a clean boundary between large phases of work. Returns immediately; the compaction runs after the current turn ends. CALL THIS LAST IN YOUR TURN — do nothing after it — or the queued compaction runs before you finish what you are doing.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'Optional instruction passed to /compact, e.g. what to preserve.',
        },
      },
    },
  },
];

// One connection per call: the socket is local and calls are rare. One line back, accumulated
// by hand: readline would re-emit the socket's errors on an Interface nobody listens to, and
// would say nothing if the daemon closed without replying.
const control = (request: Record<string, unknown>): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const client = connect(socketPath);
    let buffer = '';
    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      client.end();
      outcome();
    };
    const fail = (message: string): void => {
      settle(() => {
        reject(new DaemonError('internal', message));
      });
    };
    client.on('error', (error) => {
      fail(`flux daemon unreachable: ${error.message}`);
    });
    client.on('connect', () => {
      client.write(`${JSON.stringify(request)}\n`);
    });
    client.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const end = buffer.indexOf('\n');
      if (end === -1) return;
      let reply: unknown;
      try {
        reply = JSON.parse(buffer.slice(0, end));
      } catch {
        fail('flux daemon sent an unreadable reply');
        return;
      }
      if (isRecord(reply) && reply['ok'] === true) {
        settle(() => {
          resolve(reply['result']);
        });
      } else fail(isRecord(reply) && isString(reply['error']) ? reply['error'] : 'bad reply');
    });
    client.on('close', () => {
      fail('flux daemon closed without replying');
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
  if (name === 'flux_compact') {
    const focus =
      isString(input['focus']) && input['focus'] !== '' ? { focus: input['focus'] } : {};
    await control({ type: 'compact', session, ...focus });
    return 'Compaction queued; it runs after this turn ends. This must be the last action in your turn.';
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
