import type { AgentSpec, AgentTools } from '@flux/protocol';

// The read-only Help Agent, in ONE place (ADR 0008). The first-run seed (create-settings-store.ts)
// and a daemon-managed help session (create-help.ts) use the same definition, so a help session
// behaves identically whether or not a saved "Help" Agent still exists — the operator may have
// deleted it. This is the single source of truth for the role text.
//
// `role` and `tools` are non-optional here (unlike on `AgentSpec`), so both the seed and the help
// path can apply them without narrowing. The `deny` mode strips the agent's own Bash/Edit/Write;
// the Flux-tools floor (incl. flux_help) survives every mode (ADR 0023 § 5), so it can still reach
// the operator and look things up, and WebFetch/WebSearch stay available for the repository
// fallback the role describes.
export const helpAgentSpec: AgentSpec & { role: string; tools: AgentTools } = {
  name: 'Help',
  harness: 'claude',
  role:
    "You are the flux help agent. Answer the operator's natural-language questions about flux " +
    'plainly and briefly. Use the flux_help tool to look things up in the manual rather than ' +
    "guessing. If the flux_help tool doesn't cover the question, consult the project's public " +
    'repository at https://github.com/Musqet-Rich/flux — use WebFetch to read a specific file or ' +
    'page there, and WebSearch only to find where something lives — then answer plainly. You ' +
    'cannot change their machine.',
  tools: { mode: 'deny', list: ['Bash', 'Edit', 'Write'] },
};
