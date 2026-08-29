import { guards } from '@flux/protocol';

// One-line summaries for pi's tool calls (protocol.md § 5, Rules), the pi counterpart of
// claude/tool-summary.ts. pi's built-in tools are lower-case (`read`, `bash`, `edit`, `write`,
// `grep`, `find`, `ls`); the Flux tools arrive here too because the extension registers them
// like any other tool.

const { isString, isRecord } = guards;

const str = (value: unknown): string => (isString(value) ? value : '');

const maxLength = 120;

const clip = (text: string): string => {
  const line = text.replaceAll(/\s+/gu, ' ').trim();
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
};

const relative = (path: unknown, cwd: string): string => {
  if (!isString(path)) return '?';
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
};

const startSummary = (name: string, args: unknown, cwd: string): string => {
  const input = isRecord(args) ? args : {};
  switch (name) {
    case 'bash':
      return clip(`bash: ${str(input['command'])}`);
    case 'read':
    case 'write':
    case 'edit':
      return clip(`${name} ${relative(input['path'], cwd)}`);
    case 'grep':
    case 'find':
      return clip(`${name} ${str(input['pattern'])}`);
    case 'ls':
      return clip(`ls ${relative(input['path'], cwd)}`);
    case 'flux_ask':
      return clip(`ask: ${str(input['question'])}`);
    case 'flux_notify':
      return clip(`notify ${str(input['level'])}: ${str(input['summary'])}`);
    default:
      return clip(name);
  }
};

// pi's tool results are `{ content: [{ type: 'text', text }], details }`; the text is the output.
const resultText = (result: unknown): string => {
  const content = isRecord(result) ? result['content'] : undefined;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: unknown) => (isRecord(block) && isString(block['text']) ? block['text'] : ''))
    .join('');
};

const endSummary = (name: string, ok: boolean, result: unknown): string => {
  const status = ok ? 'ok' : 'failed';
  if (name === 'bash' || name === 'read') {
    const text = resultText(result);
    const lines = text === '' ? 0 : text.replace(/\n$/u, '').split('\n').length;
    return `${name} ${status}, ${lines} line${lines === 1 ? '' : 's'}`;
  }
  return `${name} ${status}`;
};

// Tools whose success means the worktree may have changed; the daemon re-runs git status after.
const writers = new Set(['write', 'edit', 'bash']);

const writes = (name: string): boolean => writers.has(name);

export const piToolSummary: {
  start: typeof startSummary;
  end: typeof endSummary;
  output: typeof resultText;
  writes: typeof writes;
} = { start: startSummary, end: endSummary, output: resultText, writes };
