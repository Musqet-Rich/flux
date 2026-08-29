import { connect } from 'node:net';

// The Flux tools for pi (ADR 0016): pi has no MCP client, so flux_ask and flux_notify are a pi
// extension loaded with `--extension`. Each call goes to the daemon over the control socket
// exactly as flux-mcp.ts does. Self-contained on purpose: pi loads this file through jiti from
// the daemon's dist directory, outside any workspace resolution.

interface ToolResult {
  content: { type: 'text'; text: string }[];
  details: Record<string, never>;
}

interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: Record<string, unknown>;
  // pi aborts `signal` on `{"type":"abort"}`; a waiting flux_ask must let go of the socket then.
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
}

// The slice of pi's ExtensionAPI this file uses; pi's own types are not a daemon dependency.
export interface PiExtensionApi {
  registerTool: (definition: ToolDefinition) => void;
}

// Read per call rather than at load: pi loads the extension once, before the session exists
// in every mode, and the daemon sets both for the process it spawns.
const socketPath = (): string => process.env['FLUX_CONTROL_SOCKET'] ?? '';
const session = (): string => process.env['FLUX_SESSION'] ?? '';

// Thrown from execute: pi reports a thrown error to the model as a failed tool call.
class FluxPiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FluxPiError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// The daemon's one reply line: the result, or the reason it said no.
const readReply = (line: string): { ok: true; result: unknown } | { ok: false; error: string } => {
  let reply: unknown;
  try {
    reply = JSON.parse(line);
  } catch {
    return { ok: false, error: 'flux daemon sent an unreadable reply' };
  }
  if (isRecord(reply) && reply['ok'] === true) return { ok: true, result: reply['result'] };
  const error =
    isRecord(reply) && typeof reply['error'] === 'string' ? reply['error'] : 'bad reply';
  return { ok: false, error };
};

// One connection per call, one line back, accumulated by hand (see flux-mcp.ts for why).
const control = (request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const client = connect(socketPath());
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
        reject(new FluxPiError(message));
      });
    };
    client.on('error', (error) => {
      fail(`flux daemon unreachable: ${error.message}`);
    });
    // Hanging up is what tells the daemon the ask is over (it settles it as aborted).
    signal?.addEventListener(
      'abort',
      () => {
        client.destroy();
        fail('aborted by the operator');
      },
      { once: true },
    );
    client.on('connect', () => {
      client.write(`${JSON.stringify(request)}\n`);
    });
    client.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const end = buffer.indexOf('\n');
      if (end === -1) return;
      const reply = readReply(buffer.slice(0, end));
      if (reply.ok) {
        settle(() => {
          resolve(reply.result);
        });
      } else fail(reply.error);
    });
    client.on('close', () => {
      fail('flux daemon closed without replying');
    });
  });

const text = (value: string): ToolResult => ({
  content: [{ type: 'text', text: value }],
  details: {},
});

const ask = async (params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> => {
  const question = params['question'];
  if (typeof question !== 'string') throw new FluxPiError('question is required');
  const options = params['options'];
  const result = await control(
    {
      type: 'ask',
      session: session(),
      question,
      ...(Array.isArray(options) && options.every((o) => typeof o === 'string') ? { options } : {}),
    },
    signal,
  );
  return text(isRecord(result) && typeof result['answer'] === 'string' ? result['answer'] : '');
};

const notify = async (params: Record<string, unknown>): Promise<ToolResult> => {
  const summary = params['summary'];
  if (typeof summary !== 'string') throw new FluxPiError('summary is required');
  const level = params['level'];
  await control({
    type: 'notify',
    session: session(),
    summary,
    level: level === 'done' || level === 'blocked' ? level : 'info',
  });
  return text('noted');
};

const fluxPiExtension = (pi: PiExtensionApi): void => {
  pi.registerTool({
    name: 'flux_ask',
    label: 'Ask the operator',
    description:
      'Ask the operator a question and wait for the answer. Use it for any material decision instead of guessing. Returns the answer text, or an empty string if nobody answered in time.',
    promptSnippet: 'Ask the operator a question and wait for the answer',
    promptGuidelines: [
      'Use flux_ask for any material decision (design choices, destructive actions, ambiguous requirements) instead of guessing.',
    ],
    parameters: {
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
    execute: (_id, params, signal) => ask(params, signal),
  });
  pi.registerTool({
    name: 'flux_notify',
    label: 'Notify the operator',
    description:
      'Tell the operator something without waiting: progress (info), that the task is finished (done), or that you are stuck (blocked).',
    promptSnippet: 'Notify the operator without waiting',
    promptGuidelines: [
      'Call flux_notify with level "done" when the task is complete and "blocked" when you cannot proceed.',
    ],
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One or two sentences.' },
        level: { type: 'string', enum: ['info', 'done', 'blocked'] },
      },
      required: ['summary', 'level'],
    },
    execute: (_id, params) => notify(params),
  });
};

// pi's extension contract is a default export (docs/adr/0016); the named export is for tests.
// oxlint-disable-next-line import/no-default-export
export default fluxPiExtension;
