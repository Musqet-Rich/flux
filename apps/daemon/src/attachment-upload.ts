import { attachment } from '@flux/protocol';
import type { Hash } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { DaemonError } from './daemon-error.ts';

// One attachment on its way in (ADR 0020): chunks land on disk as they arrive through a file
// handle, never buffered whole, and the sha256 runs alongside so `end` only compares digests.
// Chunks are sequential from 0; a repeat or a skip is the device's mistake (`bad_params`), as
// is more data than `attach.begin` declared. Writes are chained so two chunk calls in flight
// still land in order.

export interface Upload {
  write: (index: number, data: string) => Promise<void>;
  // Closes the file and checks the digest and the size; the file is deleted on a mismatch.
  finish: (hash: string) => Promise<void>;
  // Drops the file (a removed or expired upload).
  abort: () => Promise<void>;
}

interface State {
  handle: FileHandle;
  hash: Hash;
  next: number;
  received: number;
  chain: Promise<void>;
}

const decode = (data: string): Buffer => {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > attachment.limits.chunkBytes) {
    throw new DaemonError('bad_params', 'chunk is larger than 512 KiB');
  }
  return bytes;
};

const append = async (state: State, size: number, index: number, data: string): Promise<void> => {
  if (index !== state.next) {
    throw new DaemonError('bad_params', `expected chunk ${state.next}, got ${index}`);
  }
  const bytes = decode(data);
  if (state.received + bytes.length > size) {
    throw new DaemonError('bad_params', 'more data than the declared size');
  }
  await state.handle.write(bytes);
  state.hash.update(bytes);
  state.next += 1;
  state.received += bytes.length;
};

const finish = async (state: State, path: string, size: number, hash: string): Promise<void> => {
  await state.handle.close();
  const digest = state.hash.digest('hex');
  if (state.received !== size || digest !== hash) {
    await rm(path, { force: true });
    const why = state.received === size ? 'hash mismatch' : 'fewer bytes than declared';
    throw new DaemonError('bad_params', `upload incomplete: ${why}`);
  }
};

const settled = (): void => {};

export const attachmentUpload = async (path: string, size: number): Promise<Upload> => {
  await mkdir(dirname(path), { recursive: true });
  const state: State = {
    handle: await open(path, 'wx'),
    hash: createHash('sha256'),
    next: 0,
    received: 0,
    chain: Promise.resolve(),
  };
  // Every step queues behind the last; a failed step does not block the next, since the
  // caller decides whether the upload goes on.
  const queue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = state.chain.then(step);
    state.chain = run.then(settled, settled);
    return run;
  };
  return {
    write: (index, data) => queue(() => append(state, size, index, data)),
    finish: (hash) => queue(() => finish(state, path, size, hash)),
    abort: () =>
      queue(async () => {
        await state.handle.close().catch(() => null);
        await rm(path, { force: true });
      }),
  };
};
