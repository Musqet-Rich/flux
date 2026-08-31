import type { AgentTools } from '@flux/protocol';

// Compiles an Agent's tool policy (ADR 0023 § 4) to Claude flags, honouring the Flux-tools floor
// (§ 5). Verified empirically under `--dangerously-skip-permissions` (STEP 0, in the PR):
//   - `--disallowedTools` removes a tool's availability even when permissions are skipped;
//   - `--allowedTools` does NOT restrict there (a permission list, moot when skipped) — unusable;
//   - `--tools` is the built-in allow-list, and `--tools ""` disables every built-in tool;
//   - tools loaded via `--mcp-config` survive all of the above.
// The Flux tools (`flux_ask`/`flux_notify`/`flux_compact`/`flux_help`) ride on `--mcp-config`, so they stay usable in every
// mode — even `none`. The floor's only job here is to never name a Flux tool in the denylist.
//   all   → no flag (the full toolset, today's behaviour)
//   allow → `--tools "<built-in names>"`   (MCP Flux tools survive and so are not named)
//   deny  → `--disallowedTools "<names minus the Flux tools>"`
//   none  → `--tools ""`                    (no built-ins; the MCP Flux tools survive)

const isFluxTool = (name: string): boolean =>
  name === 'flux_ask' ||
  name === 'flux_notify' ||
  name === 'flux_compact' ||
  name === 'flux_help' ||
  name.startsWith('mcp__flux');

export const compileClaudeTools = (tools?: AgentTools): string[] => {
  if (tools === undefined || tools.mode === 'all') return [];
  if (tools.mode === 'none') return ['--tools', ''];
  const named = (tools.list ?? []).filter((name) => !isFluxTool(name));
  return [tools.mode === 'allow' ? '--tools' : '--disallowedTools', named.join(',')];
};
