import { guards } from './guards.ts';

// A file the operator attached to a message (protocol.md § 5, `msg.user.attachments`, and § 7,
// the `attach.*` methods). Files travel over the encrypted channel in base64 chunks, so the
// caps here keep every frame under the relay's 1 MiB limit and every file within what the box
// is willing to hold for one message (ADR 0020).

const { isString, isBoolean, isInteger, isRecord } = guards;

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  // The box could send it to the agent as an image block (an image type within the limit).
  image: boolean;
}

export interface AttachmentLimits {
  // Bytes per file; `attach.begin` refuses more with `too_large`.
  fileBytes: number;
  // Bytes per message, summed over its attachments; `agent.send` refuses more with `too_large`.
  messageBytes: number;
  // Raw bytes per `attach.chunk` (base64 in JSON, then deflate: under 1 MiB on the wire).
  chunkBytes: number;
  // Raw bytes per `attach.read` call at most.
  readBytes: number;
  // Largest image sent to the agent as a content block (the model API's own limit is ~5 MB).
  imageBytes: number;
}

const limits: AttachmentLimits = {
  fileBytes: 20 * 1024 * 1024,
  messageBytes: 50 * 1024 * 1024,
  chunkBytes: 512 * 1024,
  readBytes: 512 * 1024,
  imageBytes: 5 * 1024 * 1024,
};

const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// Whether a file of this type and size goes to the agent as an image block as well as a path.
const isImage = (mime: string, size: number): boolean =>
  imageTypes.includes(mime) && size <= limits.imageBytes;

const is = (v: unknown): v is Attachment =>
  isRecord(v) &&
  isString(v['id']) &&
  isString(v['name']) &&
  isString(v['mime']) &&
  isInteger(v['size']) &&
  isBoolean(v['image']);

export const attachment: {
  limits: AttachmentLimits;
  imageTypes: readonly string[];
  isImage: typeof isImage;
  is: typeof is;
} = { limits, imageTypes, isImage, is };
