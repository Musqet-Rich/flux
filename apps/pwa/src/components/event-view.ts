import type { Attachment } from '@flux/protocol';

import type { IconName } from '../icons/icons.ts';

// One entry of the session timeline, as EventItem.vue renders it (describe-event.ts builds it).
export interface EventView {
  kind: 'user' | 'assistant' | 'tool' | 'note' | 'link' | 'warning' | 'divider' | 'task' | 'report';
  text: string;
  // The value behind the tap, stringified lazily; `undefined` means there is nothing to open.
  detail: unknown;
  tone: 'ok' | 'warn' | 'error' | null;
  href?: string;
  // The Agent call a `task` row opens.
  task?: string;
  // The message a `user` row answers.
  replyTo?: number;
  // The files sent with a `user` row (ADR 0020); `thumbs` has the fetched images by id.
  attachments?: Attachment[];
  // A signal row's mark, before its text.
  icon?: IconName;
}
