#!/usr/bin/env node
import { guards } from '@flux/protocol';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

import { DaemonError } from './daemon-error.ts';

// The Flux manager MCP server (ADR 0025): a stdio JSON-RPC 2.0 server exposing the fleet-control
// tools to a MANAGER agent, forwarding each call to the daemon over the control socket. Mirrors
// flux-mcp.ts (same one-connection-per-call forwarding, same FLUX_CONTROL_SOCKET/FLUX_SESSION env).
// It is written into a session's .mcp.json only for a manager session (create-mcp-config.ts), and
// the daemon re-authorises every verb against the caller's persisted `manager` flag, so the tools
// are inert for any session that is not a manager.

const { isString, isRecord, isInteger, isOneOf } = guards;

const socketPath = process.env['FLUX_CONTROL_SOCKET'] ?? '';
const session = process.env['FLUX_SESSION'] ?? '';

const tools = [
  {
    name: 'flux_sessions_list',
    description:
      'List every session in the fleet: id, title, harness, state, repo and branch. Read-only — it changes nothing and is not audited.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_session_open',
    description:
      'Open a NEW session for a sub-task, on its own worktree. `repo` and `branch` are required; `harness` is "claude", "pi" or "opencode". Optionally name a saved agent, a model, an effort, a base branch, or a title. You CANNOT open a manager session — that is refused. Returns the new session id.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository path or name under the box repos dir.' },
        branch: { type: 'string', description: 'Branch to create or check out for the session.' },
        harness: { type: 'string', enum: ['claude', 'pi', 'opencode'] },
        agent: { type: 'string', description: 'Name of a saved Agent to seed model/effort/role.' },
        model: { type: 'string' },
        effort: { type: 'string' },
        base: { type: 'string', description: 'Base branch or commit the new branch starts from.' },
        title: { type: 'string' },
      },
      required: ['repo', 'branch', 'harness'],
    },
  },
  {
    name: 'flux_session_send',
    description:
      "Send a prompt to ANOTHER session's agent (never your own). Its agent runs the text as a user turn. `target` is that session's id.",
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: "The other session's id." },
        text: { type: 'string', description: 'The message to send to that session.' },
      },
      required: ['target', 'text'],
    },
  },
  {
    name: 'flux_session_close',
    description:
      "Archive ANOTHER session. Archiving is REVERSIBLE — the operator can reopen it — and never deletes the worktree, branch or history. There is no delete. `target` is that session's id.",
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', description: "The other session's id." } },
      required: ['target'],
    },
  },
  {
    name: 'flux_session_read',
    description:
      "Read a bounded digest of ANOTHER session's recent activity (roles and short text of its last N events), enough to supervise it without its whole history. `target` is that session's id; `limit` defaults to 40.",
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: "The other session's id." },
        limit: { type: 'number', description: 'How many recent events to digest (default 40).' },
      },
      required: ['target'],
    },
  },
];

// One connection per call: the socket is local and calls are rare. Identical to flux-mcp.ts.
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

interface ListedSession {
  session: string;
  title: string;
  harness: string;
  state: string;
  repo: string;
  branch: string;
}

const isListed = (v: unknown): v is ListedSession =>
  isRecord(v) &&
  isString(v['session']) &&
  isString(v['title']) &&
  isString(v['harness']) &&
  isString(v['state']) &&
  isString(v['repo']) &&
  isString(v['branch']);

const renderList = (result: unknown): string => {
  const list = isRecord(result) && Array.isArray(result['sessions']) ? result['sessions'] : [];
  const rows = list.filter((s): s is ListedSession => isListed(s));
  if (rows.length === 0) return 'No sessions.';
  return rows
    .map((s) => `${s.session}  ${s.state}  ${s.harness}  ${s.branch}  ${s.title}`)
    .join('\n');
};

// Only the fields that were provided are forwarded, so an omitted optional stays omitted rather
// than becoming a blank string the daemon guard would reject.
const openFields = (input: Record<string, unknown>): Record<string, unknown> => {
  const keys = ['agent', 'model', 'effort', 'base', 'title'] as const;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (isString(input[key]) && input[key] !== '') out[key] = input[key];
  return out;
};

const openSession = async (input: Record<string, unknown>): Promise<string> => {
  if (!isString(input['repo']) || !isString(input['branch'])) return 'repo and branch are required';
  const harness = isOneOf(input['harness'], ['claude', 'pi', 'opencode'])
    ? input['harness']
    : 'claude';
  const result = await control({
    type: 'session.open',
    session,
    repo: input['repo'],
    branch: input['branch'],
    harness,
    ...openFields(input),
  });
  const id = isRecord(result) && isString(result['session']) ? result['session'] : '?';
  const title = isRecord(result) && isString(result['title']) ? result['title'] : '';
  return `Opened session ${id}${title === '' ? '' : ` (${title})`}`;
};

const callTool = async (name: unknown, args: unknown): Promise<string> => {
  const input = isRecord(args) ? args : {};
  if (name === 'flux_sessions_list')
    return renderList(await control({ type: 'sessions.list', session }));
  if (name === 'flux_session_open') return openSession(input);
  if (name === 'flux_session_send' && isString(input['target']) && isString(input['text'])) {
    const result = await control({
      type: 'session.send',
      session,
      target: input['target'],
      text: input['text'],
    });
    const seq = isRecord(result) && isInteger(result['seq']) ? result['seq'] : '?';
    return `Sent to ${input['target']} (seq ${seq})`;
  }
  if (name === 'flux_session_close' && isString(input['target'])) {
    await control({ type: 'session.close', session, target: input['target'] });
    return `Archived ${input['target']} (reversible; the operator can reopen it)`;
  }
  if (name === 'flux_session_read' && isString(input['target'])) {
    const limit = isInteger(input['limit'], 1) ? { limit: input['limit'] } : {};
    const result = await control({
      type: 'session.read',
      session,
      target: input['target'],
      ...limit,
    });
    return isRecord(result) && isString(result['digest']) ? result['digest'] : '(no digest)';
  }
  throw new DaemonError('bad_params', `unknown or malformed tool ${String(name)}`);
};

const respond = (id: unknown, body: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`);
};

const simple: Record<string, () => unknown> = {
  initialize: () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'flux-manager', version: '1' },
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
