import type { CodeRef } from '@flux/protocol';
import { isCodeRef } from '@flux/protocol';
import type { DatabaseSync } from 'node:sqlite';

import { DaemonError } from './daemon-error.ts';

// Queued line comments per session (prd.md: comments queue up, then go to the agent as one
// message). A comment is removed on delete and marked sent once it has gone to the agent.

export interface Comment {
  commentId: string;
  session: string;
  ref: CodeRef;
  text: string;
  sentSeq: number | null;
}

export interface CommentStore {
  add: (session: string, ref: CodeRef, text: string) => Comment;
  remove: (session: string, commentId: string) => void;
  get: (session: string, commentIds: string[]) => Comment[];
  pending: (session: string) => Comment[];
  markSent: (commentIds: string[], seq: number) => void;
}

const toComment = (row: Record<string, unknown>): Comment => {
  const ref: unknown = JSON.parse(String(row['ref']));
  if (!isCodeRef(ref)) throw new DaemonError('internal', 'stored comment ref is invalid');
  return {
    commentId: String(row['comment_id']),
    session: String(row['session']),
    ref,
    text: String(row['text']),
    sentSeq: typeof row['sent_seq'] === 'number' ? row['sent_seq'] : null,
  };
};

export const createCommentStore = (db: DatabaseSync): CommentStore => {
  const insert = db.prepare(
    'INSERT INTO comments (comment_id, session, ref, text, sent_seq) VALUES (?, ?, ?, ?, NULL)',
  );
  const del = db.prepare('DELETE FROM comments WHERE session = ? AND comment_id = ?');
  const byId = db.prepare('SELECT * FROM comments WHERE session = ? AND comment_id = ?');
  const pendingFor = db.prepare(
    'SELECT * FROM comments WHERE session = ? AND sent_seq IS NULL ORDER BY rowid',
  );
  const sent = db.prepare('UPDATE comments SET sent_seq = ? WHERE comment_id = ?');
  return {
    add: (session, ref, text) => {
      const comment = { commentId: crypto.randomUUID(), session, ref, text, sentSeq: null };
      insert.run(comment.commentId, session, JSON.stringify(ref), text);
      return comment;
    },
    remove: (session, commentId) => {
      if (del.run(session, commentId).changes === 0) {
        throw new DaemonError('not_found', `no comment ${commentId}`);
      }
    },
    get: (session, commentIds) =>
      commentIds.map((id) => {
        const row = byId.get(session, id);
        if (row === undefined) throw new DaemonError('not_found', `no comment ${id}`);
        return toComment(row);
      }),
    pending: (session) => pendingFor.all(session).map((row) => toComment(row)),
    markSent: (commentIds, seq) => {
      for (const id of commentIds) sent.run(seq, id);
    },
  };
};
