import type { RpcMethods } from '@flux/protocol';

import type { Peer } from './create-device-channels.ts';
import type { HandlerContext } from './handler-context.ts';

// The skills methods of protocol.md § 7 (`skills.list`/`skills.write`/`skills.delete`): manage the
// `<name>/SKILL.md` files under the flux user's `~/.claude/skills`. The name is validated as a safe
// single path segment on the wire (`rpcMethods`) and again in the store, so a handler never sees a
// name that could escape the skills dir.

export type SkillsHandlers = Pick<
  {
    [M in keyof RpcMethods]: (
      params: RpcMethods[M]['params'],
      peer: Peer,
    ) => Promise<RpcMethods[M]['result']>;
  },
  'skills.list' | 'skills.write' | 'skills.delete'
>;

export const createSkillsHandlers = (ctx: HandlerContext): SkillsHandlers => ({
  'skills.list': async () => ({ skills: await ctx.skills.list() }),
  'skills.write': async (p) => {
    await ctx.skills.write(p.name, p.body);
    return {};
  },
  'skills.delete': async (p) => {
    await ctx.skills.remove(p.name);
    return {};
  },
});
