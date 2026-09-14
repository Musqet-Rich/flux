import { ClientError } from '../client/client-error.ts';
import type { AttachmentActions } from './attachment-actions.ts';
import { attachmentActions } from './attachment-actions.ts';
import { boxLink } from './box-link.ts';
import { logFold } from './log-fold.ts';
import { pendingComments } from './pending-comments.ts';
import type { StoreInternals } from './store-state.ts';

// Talking to a session, ending it and coming back (protocol.md § 7): send, clear the agent's
// context, restart it with a model and effort, archive, reopen, delete, rename. The lifecycle
// ones refresh the session list, since `archived`, `worktreeExists`, `model` and `effort` come
// from the box. Deleting resolves to an outcome because a
// `dirty` refusal is the view's to handle (it asks whether to discard), not the status bar's.

// What a restart asks for (ADR 0032): a string sets the field, null clears it to the box's
// default, absent keeps it; both absent is a plain restart.
export interface Spec {
  model?: string | null;
  effort?: string | null;
}

export interface DeleteOptions {
  removeWorktree: boolean;
  deleteBranch: boolean;
  discard: boolean;
}

// `dirty` carries the box's message (counts of uncommitted files and unpushed commits) when the
// worktree holds work that exists nowhere else; null for any other failure, already reported.
export type DeleteOutcome = { ok: true } | { ok: false; dirty: string | null };

export interface SessionActions extends AttachmentActions {
  // Sends a message carrying every pending comment and every attachment the composer holds
  // ready; `replyTo` is the seq of the message it answers. The composer draft is cleared once
  // the box has the message.
  send: (session: string, text: string, replyTo?: number) => Promise<boolean>;
  clearSession: (session: string) => Promise<boolean>;
  // Closes the agent; the next send resumes it with the spec, which the summary then carries.
  restartSession: (session: string, spec: Spec) => Promise<boolean>;
  // The new title reaches the tab through `session.renamed`, so no refresh is needed.
  renameSession: (session: string, title: string) => Promise<boolean>;
  archiveSession: (session: string) => Promise<boolean>;
  unarchiveSession: (session: string) => Promise<boolean>;
  deleteSession: (session: string, options: DeleteOptions) => Promise<DeleteOutcome>;
}

const send = async (
  i: StoreInternals,
  files: ReturnType<typeof attachmentActions>,
  session: string,
  text: string,
  replyTo?: number,
): Promise<boolean> => {
  const events = i.logs.get(session)?.events() ?? [];
  const commentIds = [...logFold.run(events, pendingComments).added.keys()];
  const attachments = files.ready(session);
  const params = {
    session,
    text,
    ...(commentIds.length > 0 ? { commentIds } : {}),
    ...(replyTo === undefined ? {} : { replyTo }),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
  const ok = await boxLink.attempt(i, () => boxLink.call(i, 'agent.send', params));
  if (ok) files.clear(session);
  return ok;
};

const archive = async (i: StoreInternals, session: string): Promise<void> => {
  await boxLink.call(i, 'sessions.archive', { session });
  await boxLink.refreshSessions(i);
};

const restart = async (i: StoreInternals, session: string, spec: Spec): Promise<void> => {
  await boxLink.call(i, 'sessions.restart', { session, ...spec });
  await boxLink.refreshSessions(i);
};

const unarchive = async (i: StoreInternals, session: string): Promise<void> => {
  await boxLink.call(i, 'sessions.unarchive', { session });
  await boxLink.refreshSessions(i);
};

const remove = async (
  i: StoreInternals,
  session: string,
  options: DeleteOptions,
): Promise<DeleteOutcome> => {
  try {
    await boxLink.call(i, 'sessions.archive', { session, ...options });
  } catch (error) {
    if (error instanceof ClientError && error.code === 'dirty') {
      return { ok: false, dirty: error.message };
    }
    boxLink.reportError(i, error);
    return { ok: false, dirty: null };
  }
  boxLink.clearActionError(i);
  await boxLink.refreshSessions(i);
  return { ok: true };
};

export const sessionActions = (i: StoreInternals): SessionActions => {
  const files = attachmentActions(i);
  return {
    ...files,
    send: (session, text, replyTo) => send(i, files, session, text, replyTo),
    clearSession: (session) =>
      boxLink.attempt(i, () => boxLink.call(i, 'sessions.clear', { session })),
    restartSession: (session, spec) => boxLink.attempt(i, () => restart(i, session, spec)),
    renameSession: (session, title) =>
      boxLink.attempt(i, () => boxLink.call(i, 'sessions.rename', { session, title })),
    archiveSession: (session) => boxLink.attempt(i, () => archive(i, session)),
    unarchiveSession: (session) => boxLink.attempt(i, () => unarchive(i, session)),
    deleteSession: (session, options) => remove(i, session, options),
  };
};
