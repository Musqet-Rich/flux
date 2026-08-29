import { guards } from '@flux/protocol';

// One-line, human-readable summaries for tool.start / tool.end (protocol.md § 5, Rules). The
// PWA renders these in the timeline and only fetches input/output on expand.

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

const startSummary = (name: string, input: unknown, cwd: string): string => {
  const args = isRecord(input) ? input : {};
  switch (name) {
    case 'Bash':
      return clip(`Bash: ${str(args['command'])}`);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return clip(`${name} ${relative(args['file_path'], cwd)}`);
    case 'Glob':
    case 'Grep':
      return clip(`${name} ${str(args['pattern'])}`);
    case 'WebFetch':
      return clip(`WebFetch ${str(args['url'])}`);
    case 'WebSearch':
      return clip(`WebSearch ${str(args['query'])}`);
    case 'Task':
    case 'Agent':
      return clip(`${name}: ${str(args['description'])}`);
    default:
      return clip(name);
  }
};

// A subagent's tool_result line carries no `tool_use_result` (fixture session-subagents), so
// the block's own content stands in for stdout there.
const stdoutOf = (result: Record<string, unknown>, content: unknown): string => {
  if (isString(result['stdout'])) return result['stdout'];
  return isString(content) ? content : '';
};

const endSummary = (
  name: string,
  ok: boolean,
  toolUseResult: unknown,
  content?: unknown,
): string => {
  const result = isRecord(toolUseResult) ? toolUseResult : {};
  const status = ok ? 'ok' : 'failed';
  if (name === 'Bash') {
    const stdout = stdoutOf(result, content);
    const lines = stdout === '' ? 0 : stdout.split('\n').length;
    return `Bash ${status}, ${lines} line${lines === 1 ? '' : 's'}`;
  }
  if (name === 'Read') {
    const file = result['file'];
    const count = isRecord(file) && typeof file['numLines'] === 'number' ? file['numLines'] : null;
    return count === null ? `Read ${status}` : `Read ${status}, ${count} lines`;
  }
  return `${name} ${status}`;
};

// Tools whose result means the worktree may have changed; the daemon re-runs git status after.
const writers = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash']);

const writes = (name: string): boolean => writers.has(name);

export const toolSummary: {
  start: typeof startSummary;
  end: typeof endSummary;
  writes: typeof writes;
} = { start: startSummary, end: endSummary, writes };
