import type { RpcMethods } from '@flux/protocol';

import type { Peer } from './create-device-channels.ts';
import type { HandlerContext } from './handler-context.ts';

// The `attach.*` methods of protocol.md § 7 (ADR 0020): a file arrives in sequential chunks
// and is stored on the box; `agent.send` later names it by id. The store does the checking
// (caps, order, hash, path safety); a handler only proves the session exists on `begin`.

export type AttachmentHandlers = Pick<
  {
    [M in keyof RpcMethods]: (
      params: RpcMethods[M]['params'],
      peer: Peer,
    ) => Promise<RpcMethods[M]['result']>;
  },
  'attach.begin' | 'attach.chunk' | 'attach.end' | 'attach.read' | 'attach.delete'
>;

export const createAttachmentHandlers = (ctx: HandlerContext): AttachmentHandlers => ({
  'attach.begin': async (p) => {
    ctx.sessions.get(p.session);
    return { attachmentId: await ctx.attachments.begin(p.session, p.name, p.mime, p.size) };
  },
  'attach.chunk': async (p) => {
    await ctx.attachments.chunk(p.attachmentId, p.index, p.data);
    return {};
  },
  'attach.end': (p) => ctx.attachments.end(p.attachmentId, p.hash),
  'attach.read': (p) => ctx.attachments.read(p.attachmentId, p.offset, p.length),
  'attach.delete': async (p) => {
    await ctx.attachments.remove(p.attachmentId);
    return {};
  },
});
