import { attachment } from '@flux/protocol';
import type { FileHandle } from 'node:fs/promises';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { Upload } from './attachment-upload.ts';
import { attachmentUpload } from './attachment-upload.ts';
import { DaemonError } from './daemon-error.ts';
import { inside } from './inside.ts';

// Files the operator attaches to messages (ADR 0020, protocol.md § 7 `attach.*`). Rows live in
// SQLite, bytes under `<dataDir>/attachments/<session>/<id>-<name>`, never in a worktree, so an
// agent cannot commit them by accident. Cleanup is lazy, with no timer: on start and on every
// `begin`, an upload that never ended within 10 minutes and an attachment that was never
// sent within 24 hours are deleted; a sent one stays until the session is deleted, which takes
// the whole directory with it (a plain archive keeps it, so a reopened session shows it).

export interface AttachmentRecord {
  id: string;
  session: string;
  name: string;
  mime: string;
  size: number;
  hash: string;
  complete: boolean;
  sentSeq: number | null;
  createdAt: string;
  path: string;
}

export interface AttachmentSlice {
  data: string;
  size: number;
  mime: string;
  name: string;
}

export interface AttachmentStore {
  begin: (session: string, name: string, mime: string, size: number) => Promise<string>;
  chunk: (id: string, index: number, data: string) => Promise<void>;
  end: (id: string, hash: string) => Promise<{ path: string; size: number }>;
  read: (id: string, offset: number, length: number) => Promise<AttachmentSlice>;
  remove: (id: string) => Promise<void>;
  // The complete attachments `ids` name, all belonging to `session`; `bad_params` otherwise.
  get: (session: string, ids: string[]) => AttachmentRecord[];
  markSent: (ids: string[], seq: number) => void;
  removeSession: (session: string) => Promise<void>;
  // Deletes what nobody will finish or send any more; returns how many went.
  sweep: () => Promise<number>;
}

export interface AttachmentStoreOptions {
  db: DatabaseSync;
  dir: string;
  now?: () => Date;
}

const uploadWithinMs = 10 * 60 * 1000;
const unsentWithinMs = 24 * 60 * 60 * 1000;

// `[A-Za-z0-9._-]` only, so the name is safe in a path and on any shell; capped so a long
// name cannot exceed a filesystem's limit once the id is prepended.
const safeName = (name: string): string => {
  const cleaned = name
    .replaceAll(/[^A-Za-z0-9._-]/gu, '_')
    .replace(/^\.+/u, '')
    .slice(0, 100);
  return cleaned === '' ? 'file' : cleaned;
};

const toRecord = (dir: string, row: Record<string, unknown>): AttachmentRecord => ({
  id: String(row['id']),
  session: String(row['session']),
  name: String(row['name']),
  mime: String(row['mime']),
  size: Number(row['size']),
  hash: String(row['hash']),
  complete: row['complete'] === 1,
  sentSeq: typeof row['sent_seq'] === 'number' ? row['sent_seq'] : null,
  createdAt: String(row['created_at']),
  path: join(dir, String(row['session']), `${String(row['id'])}-${String(row['name'])}`),
});

const readSlice = async (
  record: AttachmentRecord,
  offset: number,
  length: number,
): Promise<AttachmentSlice> => {
  let handle: FileHandle;
  try {
    handle = await open(record.path, 'r');
  } catch {
    throw new DaemonError('not_found', `attachment ${record.id} is gone from disk`);
  }
  try {
    const want = Math.max(0, Math.min(length, record.size - offset));
    const buffer = Buffer.alloc(want);
    const { bytesRead } = await handle.read(buffer, 0, want, offset);
    const data = buffer.subarray(0, bytesRead).toString('base64');
    return { data, size: record.size, mime: record.mime, name: record.name };
  } finally {
    await handle.close();
  }
};

interface Statements {
  insert: StatementSync;
  byId: StatementSync;
  finish: StatementSync;
  sent: StatementSync;
  del: StatementSync;
  delSession: StatementSync;
  stale: StatementSync;
  bySession: StatementSync;
}

const prepare = (db: DatabaseSync): Statements => ({
  insert: db.prepare(
    'INSERT INTO attachments (id, session, name, mime, size, hash, complete, sent_seq, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)',
  ),
  byId: db.prepare('SELECT * FROM attachments WHERE id = ?'),
  finish: db.prepare('UPDATE attachments SET complete = 1, hash = ? WHERE id = ?'),
  sent: db.prepare('UPDATE attachments SET sent_seq = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM attachments WHERE id = ?'),
  delSession: db.prepare('DELETE FROM attachments WHERE session = ?'),
  stale: db.prepare(
    'SELECT * FROM attachments WHERE (complete = 0 AND created_at < ?) OR (complete = 1 AND sent_seq IS NULL AND created_at < ?)',
  ),
  bySession: db.prepare('SELECT * FROM attachments WHERE session = ?'),
});

interface Shared {
  sql: Statements;
  dir: string;
  now: () => Date;
  uploads: Map<string, Upload>;
  record: (id: string) => AttachmentRecord;
  // Deletes the file (or aborts its upload) and the row.
  drop: (r: AttachmentRecord) => Promise<void>;
}

const shared = (options: AttachmentStoreOptions): Shared => {
  const sql = prepare(options.db);
  const uploads = new Map<string, Upload>();
  const record = (id: string): AttachmentRecord => {
    const row = sql.byId.get(id);
    if (row === undefined) throw new DaemonError('not_found', `no attachment ${id}`);
    return toRecord(options.dir, row);
  };
  const drop = async (r: AttachmentRecord): Promise<void> => {
    const pending = uploads.get(r.id);
    uploads.delete(r.id);
    if (pending === undefined) await rm(r.path, { force: true });
    else await pending.abort();
    sql.del.run(r.id);
  };
  const now = options.now ?? ((): Date => new Date());
  return { sql, dir: options.dir, now, uploads, record, drop };
};

const sweep = async (s: Shared): Promise<number> => {
  const at = s.now().getTime();
  const upCut = new Date(at - uploadWithinMs).toISOString();
  const sentCut = new Date(at - unsentWithinMs).toISOString();
  const rows = s.sql.stale.all(upCut, sentCut).map((row) => toRecord(s.dir, row));
  await Promise.all(rows.map((r) => s.drop(r)));
  return rows.length;
};

const pending = (s: Shared, id: string): Upload => {
  const upload = s.uploads.get(id);
  if (upload === undefined) throw new DaemonError('not_found', `no upload ${id} in progress`);
  return upload;
};

const uploading = (s: Shared): Pick<AttachmentStore, 'begin' | 'chunk' | 'end'> => ({
  begin: async (session, name, mime, size) => {
    if (size > attachment.limits.fileBytes) {
      throw new DaemonError('too_large', 'a file may be at most 20 MiB');
    }
    await sweep(s);
    const id = crypto.randomUUID();
    const safe = safeName(name);
    const path = inside(s.dir, join(session, `${id}-${safe}`));
    s.uploads.set(id, await attachmentUpload(path, size));
    s.sql.insert.run(id, session, safe, mime, size, '', s.now().toISOString());
    return id;
  },
  // Async so a missing upload rejects rather than throws, like every other failure here.
  chunk: async (id, index, data) => pending(s, id).write(index, data),
  end: async (id, hash) => {
    const r = s.record(id);
    const upload = pending(s, id);
    s.uploads.delete(id);
    try {
      await upload.finish(hash);
    } catch (error) {
      s.sql.del.run(id);
      throw error;
    }
    s.sql.finish.run(hash, id);
    return { path: r.path, size: r.size };
  },
});

// Open uploads of the session close first, so the directory is not recreated under a closing
// handle after it has gone.
const removeSession = async (s: Shared, session: string): Promise<void> => {
  const ids = s.sql.bySession.all(session).map((row) => String(row['id']));
  const live = ids.map((id) => s.uploads.get(id)).filter((u) => u !== undefined);
  for (const id of ids) s.uploads.delete(id);
  await Promise.all(live.map((u) => u.abort()));
  await rm(inside(s.dir, session), { recursive: true, force: true });
  s.sql.delSession.run(session);
};

export const createAttachmentStore = (options: AttachmentStoreOptions): AttachmentStore => {
  const s = shared(options);
  void sweep(s).catch(() => null);
  return {
    ...uploading(s),
    read: async (id, offset, length) => {
      const r = s.record(id);
      if (!r.complete) throw new DaemonError('not_found', `attachment ${id} is still uploading`);
      return readSlice(r, offset, length);
    },
    remove: async (id) => s.drop(s.record(id)),
    get: (session, ids) =>
      ids.map((id) => {
        const r = s.record(id);
        if (r.session !== session || !r.complete) {
          throw new DaemonError('bad_params', `attachment ${id} is not ready for this session`);
        }
        return r;
      }),
    markSent: (ids, seq) => {
      for (const id of ids) s.sql.sent.run(seq, id);
    },
    removeSession: (session) => removeSession(s, session),
    sweep: () => sweep(s),
  };
};
