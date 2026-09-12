import { join } from 'node:path';

// Where Claude Code keeps a session's transcript: `<config dir>/projects/<slug>/<session id>.jsonl`,
// the slug being the `cwd` the agent prints on its `init` line with every character outside
// `A-Za-z0-9` replaced by `-` (verified 2026-09-12 against Claude Code 2.1.269), the config dir
// the daemon's `claudeDir` (ADR 0028).

const slug = (path: string): string => path.replaceAll(/[^A-Za-z0-9]/gu, '-');

export const transcriptPath = (cwd: string, agentSessionId: string, configDir: string): string =>
  join(configDir, 'projects', slug(cwd), `${agentSessionId}.jsonl`);
