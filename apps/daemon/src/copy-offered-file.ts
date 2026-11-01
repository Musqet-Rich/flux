import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { constants } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { DaemonError } from './daemon-error.ts';

// The copy behind `flux_file_send` (ADR 0036): the file the agent names is copied into the
// session's attachments directory at the call, so editing or deleting the source afterwards
// changes nothing the operator downloads. The checks come first and are worded for the agent,
// which reads them as the tool's error: a missing path, a directory, anything that is not a
// regular file (a FIFO would block the read forever, a device file never ends) and a file over
// the cap are all refused before a byte moves. The copy streams through a file handle with the
// digest alongside, as an upload does (attachment-upload.ts), and the cap is enforced again on
// the bytes themselves, so a file that grows between the check and the copy is still refused.

export interface CopiedFile {
  size: number;
  hash: string;
}

const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

const statOf = async (source: string): Promise<Stats> => {
  try {
    return await stat(source);
  } catch (error) {
    // A missing file and a path through a file are both "nothing there"; anything else (a
    // directory on the way the agent's user cannot search, say) is a path it cannot read.
    const code = error instanceof Error && 'code' in error ? error.code : null;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new DaemonError('not_found', `no file at ${source}`);
    }
    throw new DaemonError('bad_params', `cannot read ${source}`);
  }
};

const refuseShape = (source: string, info: Stats, limit: number): void => {
  if (info.isDirectory()) {
    throw new DaemonError('bad_params', `${source} is a directory; offer a single file`);
  }
  if (!info.isFile()) throw new DaemonError('bad_params', `${source} is not a regular file`);
  if (info.size > limit) {
    throw new DaemonError(
      'too_large',
      `${source} is ${mib(info.size)}; a file offered may be at most ${mib(limit)}`,
    );
  }
};

// Counts and digests the bytes on their way through, failing once they pass the cap.
const meter = (source: string, limit: number): { pass: Transform; result: () => CopiedFile } => {
  const hash = createHash('sha256');
  let size = 0;
  const pass = new Transform({
    transform: (chunk: Buffer, _encoding, done) => {
      size += chunk.length;
      if (size > limit) {
        done(new DaemonError('too_large', `${source} grew past ${mib(limit)} while it was copied`));
        return;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });
  return { pass, result: () => ({ size, hash: hash.digest('hex') }) };
};

export const copyOfferedFile = async (
  source: string,
  target: string,
  limit: number,
): Promise<CopiedFile> => {
  refuseShape(source, await statOf(source), limit);
  // Non-blocking, so a path swapped for a FIFO since the stat cannot hang the open; the
  // handle's own stat then settles what was actually opened.
  const input = await open(source, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => {
    throw new DaemonError('bad_params', `cannot read ${source}`);
  });
  try {
    refuseShape(source, await input.stat(), limit);
    await mkdir(dirname(target), { recursive: true });
    const output = await open(target, 'wx');
    const { pass, result } = meter(source, limit);
    try {
      await pipeline(input.createReadStream(), pass, output.createWriteStream());
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
    return result();
  } finally {
    await input.close().catch(() => null);
  }
};
