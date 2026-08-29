import { attachment } from '@flux/protocol';
import { readFile } from 'node:fs/promises';

// The attached images an agent can take as content blocks (ADR 0020): the four types the
// model API accepts, within its size limit, read from the box's copy and base64-encoded. A
// file that cannot be read is skipped; its path line (render-attachments.ts) still tells the
// agent where it is.

export interface ImageBlock {
  mediaType: string;
  data: string;
}

export interface ImageCandidate {
  path: string;
  mime: string;
  size: number;
}

const load = async (file: ImageCandidate): Promise<ImageBlock | null> => {
  try {
    const bytes = await readFile(file.path);
    return { mediaType: file.mime, data: bytes.toString('base64') };
  } catch {
    return null;
  }
};

export const attachmentImages = async (files: ImageCandidate[]): Promise<ImageBlock[]> => {
  const images = files.filter((f) => attachment.isImage(f.mime, f.size));
  const loaded = await Promise.all(images.map((f) => load(f)));
  return loaded.filter((block) => block !== null);
};
