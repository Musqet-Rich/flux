import type { CodeRef } from '@flux/protocol';

import type { AttachedFile } from './render-attachments.ts';
import { renderAttachments } from './render-attachments.ts';
import { renderRefs } from './render-refs.ts';
import type { Reply } from './render-reply.ts';
import { renderReply } from './render-reply.ts';

// The text of one user turn as the agent receives it, assembled from what the operator sent:
// the quoted message it answers first (render-reply.ts), the message, then the referenced code
// (render-refs.ts) and the attached files (render-attachments.ts).

export interface PromptInput {
  text: string;
  refs: CodeRef[];
  // `contents[i]` is the file behind `refs[i]`, or null when it could not be read.
  contents: (string | null)[];
  reply: Reply | null;
  attachments: AttachedFile[];
}

export const renderPrompt = (input: PromptInput): string =>
  renderReply(
    renderAttachments(renderRefs(input.text, input.refs, input.contents), input.attachments),
    input.reply,
  );
