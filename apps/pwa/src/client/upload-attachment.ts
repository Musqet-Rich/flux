import { attachment } from '@flux/protocol';

import { base64 } from './base64.ts';
import { ClientError } from './client-error.ts';
import type { RpcCall } from './create-rpc-client.ts';

// One file to the box over the channel (protocol.md § 7, ADR 0020): `attach.begin`, the
// file's bytes in sequential 512 KiB chunks read with `Blob.slice`, then `attach.end` with the
// sha256 of the whole file, so the box can refuse a corrupted upload. The whole file is hashed
// up front (WebCrypto has no streaming digest); at 20 MiB that is a moment on a phone.

export interface UploadOptions {
  call: RpcCall;
  session: string;
  file: File;
  // The box's id for the attachment, as soon as `attach.begin` answers, so a removal while the
  // upload runs can delete it.
  onBegun: (id: string) => void;
  // Fraction of the bytes sent so far.
  onProgress: (fraction: number) => void;
  // Checked before each chunk; a removed attachment stops uploading and rejects `cancelled`.
  cancelled: () => boolean;
}

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

const sha256 = async (file: File): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));

const sendChunks = async (o: UploadOptions, attachmentId: string, index: number): Promise<void> => {
  const { chunkBytes } = attachment.limits;
  const offset = index * chunkBytes;
  if (offset >= o.file.size) return;
  if (o.cancelled()) throw new ClientError('cancelled', 'attachment removed');
  const bytes = new Uint8Array(await o.file.slice(offset, offset + chunkBytes).arrayBuffer());
  await o.call('attach.chunk', { attachmentId, index, data: base64.encode(bytes) });
  o.onProgress(Math.min(1, (offset + bytes.length) / Math.max(1, o.file.size)));
  await sendChunks(o, attachmentId, index + 1);
};

export const uploadAttachment = async (o: UploadOptions): Promise<string> => {
  const hash = await sha256(o.file);
  const { name, type, size } = o.file;
  const mime = type === '' ? 'application/octet-stream' : type;
  const { attachmentId } = await o.call('attach.begin', { session: o.session, name, mime, size });
  o.onBegun(attachmentId);
  await sendChunks(o, attachmentId, 0);
  if (o.cancelled()) throw new ClientError('cancelled', 'attachment removed');
  await o.call('attach.end', { attachmentId, hash });
  o.onProgress(1);
  return attachmentId;
};
