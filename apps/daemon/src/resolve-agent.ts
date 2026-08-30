import type { AgentSpec, AgentTools } from '@flux/protocol';

import { DaemonError } from './daemon-error.ts';

// Resolve a session's model/effort/role/tools at create (ADR 0023 § 2/§ 3): each field is the
// inline override if given, else the named Agent's, else unset (the box default). `role` and
// `tools` are Agent-only (no inline override). The create call's harness always wins, so an
// Agent's own `harness` pin is advisory and not applied here. An `agent` name that no saved Agent
// matches is `bad_params`, before any worktree is made.

export interface AgentResolution {
  model?: string;
  effort?: string;
  role?: string;
  tools?: AgentTools;
  // The Agent's `manager` flag (ADR 0025); Agent-only (no inline override), omitted when off.
  manager?: boolean;
}

export const resolveAgent = (
  params: { agent?: string; model?: string; effort?: string },
  agents: AgentSpec[],
): AgentResolution => {
  const named =
    params.agent === undefined ? undefined : agents.find((a) => a.name === params.agent);
  if (params.agent !== undefined && named === undefined) {
    throw new DaemonError('bad_params', `no saved agent named ${params.agent}`);
  }
  const model = params.model ?? named?.model;
  const effort = params.effort ?? named?.effort;
  const role = named?.role;
  const tools = named?.tools;
  // Agent-only and boolean: carried only when the Agent turned it on, so an ordinary Agent leaves
  // the session record's `manager` unset (the authorisation check treats absent as not a manager).
  const manager = named?.manager === true ? true : undefined;
  return {
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(role === undefined ? {} : { role }),
    ...(tools === undefined ? {} : { tools }),
    ...(manager === undefined ? {} : { manager }),
  };
};
