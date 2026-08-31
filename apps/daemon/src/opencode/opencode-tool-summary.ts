import { guards } from '@flux/protocol';

// One-line summaries for opencode's tool calls (protocol.md § 5, Rules), the opencode counterpart
// of claude/tool-summary.ts and pi/pi-tool-summary.ts. opencode's built-in tools are lower-case
// (`bash`, `read`, `write`, `edit`, `grep`, `glob`, `list`, `webfetch`, `patch`); the Flux tools
// arrive here too as the injected MCP server registers them like any other tool.

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
      return clip(`${name} ${relative(input['filePath'] ?? input['path'], cwd)}`);
    case 'grep':
      return clip(`grep ${str(input['pattern'])}`);
    case 'glob':
      return clip(`glob ${str(input['pattern'])}`);
    case 'list':
      return clip(`list ${relative(input['path'], cwd)}`);
    case 'flux_ask':
      return clip(`ask: ${str(input['question'])}`);
    case 'flux_notify':
      return clip(`notify ${str(input['level'])}: ${str(input['summary'])}`);
    default:
      return clip(name);
  }
};

const endSummary = (name: string, ok: boolean, output: string): string => {
  const status = ok ? 'ok' : 'failed';
  if (name === 'bash' || name === 'read') {
    const lines = output === '' ? 0 : output.replace(/\n$/u, '').split('\n').length;
    return `${name} ${status}, ${lines} line${lines === 1 ? '' : 's'}`;
  }
  return `${name} ${status}`;
};

// Tools whose success means the worktree may have changed; the daemon re-runs git status after.
const writers = new Set(['write', 'edit', 'bash', 'patch']);

const writes = (name: string): boolean => writers.has(name);

export const opencodeToolSummary: {
  start: typeof startSummary;
  end: typeof endSummary;
  writes: typeof writes;
} = { start: startSummary, end: endSummary, writes };
