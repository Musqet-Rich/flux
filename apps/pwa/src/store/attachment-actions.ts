import type { Attachment, FluxEvent } from '@flux/protocol';
import { attachment, fluxEvent } from '@flux/protocol';

import { base64 } from '../client/base64.ts';
import { uploadAttachment } from '../client/upload-attachment.ts';
import { boxLink } from './box-link.ts';
import type { ComposerDraft, PendingAttachment, StoreInternals } from './store-state.ts';

// Files on the way to the box and images back from it (ADR 0020). A file added to the
// composer starts uploading at once; its chip follows `state.composers[session].attachments`,
// which outlives the composer, so leaving the session and coming back keeps the draft. The
// `File` objects and the in-flight state stay off the reactive state, in the internals.
// Thumbnails of sent images are fetched with `attach.read` and kept as blob URLs per session
// until `leave`.

export interface AttachmentActions {
  // The composer's draft for a session, created empty on first use.
  composer: (session: string) => ComposerDraft;
  attach: (session: string, files: File[]) => void;
  removeAttachment: (session: string, key: string) => void;
  retryAttachment: (session: string, key: string) => void;
  // Fetches the thumbnails of every image attached to a `msg.user` among `rows`, once each.
  loadThumbnails: (session: string, rows: readonly FluxEvent[]) => void;
  // Drops the session's thumbnails (the blob URLs are revoked).
  leave: (session: string) => void;
}

const composer = (i: StoreInternals, session: string): ComposerDraft => {
  const existing = i.state.composers[session];
  if (existing !== undefined) return existing;
  // Read back, so the caller holds the reactive proxy and not the plain object.
  i.state.composers[session] = { text: '', attachments: [] };
  return i.state.composers[session] ?? { text: '', attachments: [] };
};

// Best effort: the box sweeps what this misses (create-attachment-store.ts).
const discard = (i: StoreInternals, id: string): void => {
  void boxLink.call(i, 'attach.delete', { attachmentId: id }).catch(() => null);
};

const run = async (i: StoreInternals, session: string, entry: PendingAttachment): Promise<void> => {
  const file = i.files.get(entry.key);
  if (file === undefined) return;
  entry.status = 'uploading';
  entry.progress = 0;
  entry.error = null;
  entry.id = null;
  try {
    entry.id = await uploadAttachment({
      call: (method, params) => boxLink.call(i, method, params),
      session,
      file,
      onBegun: (id) => {
        entry.id = id;
      },
      onProgress: (fraction) => {
        entry.progress = fraction;
      },
      cancelled: () => !i.files.has(entry.key),
    });
    // Removed while `attach.end` was in flight: the box has a file nobody will send.
    if (!i.files.has(entry.key)) discard(i, entry.id);
    entry.status = 'ready';
  } catch (error) {
    if (entry.id !== null) discard(i, entry.id);
    entry.id = null;
    entry.status = 'failed';
    entry.error = error instanceof Error ? error.message : String(error);
  }
};

const attach = (i: StoreInternals, session: string, files: File[]): void => {
  const draft = composer(i, session);
  for (const file of files) {
    const key = crypto.randomUUID();
    const image = attachment.isImage(file.type, file.size);
    i.files.set(key, file);
    const entry: PendingAttachment = {
      key,
      id: null,
      name: file.name,
      mime: file.type,
      size: file.size,
      image,
      preview: image ? URL.createObjectURL(file) : null,
      status: 'uploading',
      progress: 0,
      error: null,
    };
    draft.attachments.push(entry);
    const live = draft.attachments.at(-1);
    void run(i, session, live ?? entry);
  }
};

const remove = (i: StoreInternals, session: string, key: string): void => {
  const draft = composer(i, session);
  const at = draft.attachments.findIndex((a) => a.key === key);
  const entry = draft.attachments[at];
  if (entry === undefined) return;
  draft.attachments.splice(at, 1);
  i.files.delete(key);
  if (entry.preview !== null) URL.revokeObjectURL(entry.preview);
  // An upload still running sees the file gone, stops and deletes its own attachment.
  if (entry.status !== 'uploading' && entry.id !== null) discard(i, entry.id);
};

const retry = (i: StoreInternals, session: string, key: string): void => {
  const entry = composer(i, session).attachments.find((a) => a.key === key);
  if (entry === undefined || entry.status !== 'failed') return;
  void run(i, session, entry);
};

// The message went: the draft and its files are done with, the previews released.
const clear = (i: StoreInternals, session: string): void => {
  const draft = composer(i, session);
  for (const entry of draft.attachments) {
    i.files.delete(entry.key);
    if (entry.preview !== null) URL.revokeObjectURL(entry.preview);
  }
  draft.attachments = [];
  draft.text = '';
};

// The ids of the attachments ready to go with the next message.
const ready = (i: StoreInternals, session: string): string[] =>
  composer(i, session)
    .attachments.map((a) => (a.status === 'ready' ? a.id : null))
    .filter((id) => id !== null);

// The whole file in `attach.read` pages, then a blob URL for the `<img>`.
const fetchThumb = async (i: StoreInternals, a: Attachment): Promise<string> => {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const page = async (): Promise<void> => {
    if (offset >= a.size) return;
    const slice = await boxLink.call(i, 'attach.read', {
      attachmentId: a.id,
      offset,
      length: attachment.limits.readBytes,
    });
    const bytes = base64.decode(slice.data);
    if (bytes.length === 0) return;
    parts.push(bytes);
    offset += bytes.length;
    await page();
  };
  await page();
  return URL.createObjectURL(new Blob(parts, { type: a.mime }));
};

const attachedImages = (rows: readonly FluxEvent[]): Attachment[] =>
  rows.flatMap((row) =>
    fluxEvent.isKnown(row) && row.type === 'msg.user'
      ? (row.payload.attachments ?? []).filter((a) => a.image)
      : [],
  );

const loadThumbnails = (i: StoreInternals, session: string, rows: readonly FluxEvent[]): void => {
  for (const a of attachedImages(rows)) {
    if (i.thumbLoads.has(a.id)) continue;
    const owned = i.thumbOwners.get(session) ?? new Set<string>();
    owned.add(a.id);
    i.thumbOwners.set(session, owned);
    const load = async (): Promise<void> => {
      try {
        i.state.thumbs[a.id] = await fetchThumb(i, a);
      } catch {
        // A thumbnail that could not be fetched leaves the name and size showing; the next
        // visit to the session tries again.
        i.thumbLoads.delete(a.id);
      }
    };
    i.thumbLoads.set(a.id, load());
  }
};

const leave = (i: StoreInternals, session: string): void => {
  for (const id of i.thumbOwners.get(session) ?? []) {
    const url = i.state.thumbs[id];
    if (url !== undefined) URL.revokeObjectURL(url);
    Reflect.deleteProperty(i.state.thumbs, id);
    i.thumbLoads.delete(id);
  }
  i.thumbOwners.delete(session);
};

export const attachmentActions = (
  i: StoreInternals,
): AttachmentActions & {
  ready: (session: string) => string[];
  clear: (session: string) => void;
} => ({
  composer: (session) => composer(i, session),
  attach: (session, files) => {
    attach(i, session, files);
  },
  removeAttachment: (session, key) => {
    remove(i, session, key);
  },
  retryAttachment: (session, key) => {
    retry(i, session, key);
  },
  loadThumbnails: (session, rows) => {
    loadThumbnails(i, session, rows);
  },
  leave: (session) => {
    leave(i, session);
  },
  ready: (session) => ready(i, session),
  clear: (session) => {
    clear(i, session);
  },
});
