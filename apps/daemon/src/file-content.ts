import type { FileContent } from '@flux/protocol';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { DaemonError } from './daemon-error.ts';

// Files as the wire sees them (protocol.md § 7, FileContent): content capped at 1 MiB with
// `truncated` set, a sha256 of the whole file as the token for a conditional write, and the
// write itself, which lands atomically via a temp file in the same directory.

const cap = 1024 * 1024;

const hashOf = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

// Text is what decodes as UTF-8 without loss; anything else goes out as base64 and cannot be
// edited, because a lossy decode would come back as different bytes under the same hash.
const decodeText = (data: Buffer): string | null => {
  if (data.subarray(0, 8000).includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return null;
  }
};

const fromBytes = (data: Buffer): FileContent => {
  const truncated = data.length > cap;
  const head = truncated ? data.subarray(0, cap) : data;
  const text = decodeText(data);
  return {
    content: text === null ? head.toString('base64') : (decodeText(head) ?? text.slice(0, cap)),
    binary: text === null,
    hash: hashOf(data),
    truncated,
  };
};

const codeOf = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';

// Filesystem errors as RPC errors: a path through a file or over a directory is the caller's
// mistake, anything else missing is not_found.
const fsError = (error: unknown): DaemonError => {
  const code = codeOf(error);
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'EISDIR' || code === 'ENOTDIR') return new DaemonError('bad_params', message);
  return new DaemonError('not_found', message);
};

const read = async (path: string): Promise<FileContent> => {
  try {
    return fromBytes(await readFile(path));
  } catch (error) {
    throw fsError(error);
  }
};

// The current file's hash and mode; null when there is no file yet.
const current = async (path: string): Promise<{ hash: string; mode: number } | null> => {
  try {
    const [data, info] = await Promise.all([readFile(path), stat(path)]);
    return { hash: hashOf(data), mode: info.mode };
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    throw fsError(error);
  }
};

const replace = async (path: string, data: Buffer, mode: number | null): Promise<void> => {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temp, data);
    if (mode !== null) await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => null);
    throw fsError(error);
  }
};

const writeNow = async (path: string, content: string, ifMatch: string | null): Promise<string> => {
  const before = await current(path);
  if (ifMatch !== null && before === null) {
    throw new DaemonError('not_found', `${basename(path)} is gone`);
  }
  if (ifMatch !== null && before !== null && before.hash !== ifMatch) {
    throw new DaemonError('conflict', `${basename(path)} changed since it was read`);
  }
  const data = Buffer.from(content, 'utf8');
  await replace(path, data, before === null ? null : before.mode);
  return hashOf(data);
};

// Writes to one path run one after another, so two devices saving with the same `ifMatch`
// cannot both win; the second sees the first's hash and gets `conflict`. An agent writing
// through its own tools is outside this chain (protocol.md § 7).
// The stored chain never rejects, so a refused write does not block the next one.
const chains = new Map<string, Promise<null>>();

const write = (path: string, content: string, ifMatch: string | null): Promise<string> => {
  const previous = chains.get(path) ?? Promise.resolve(null);
  const run = previous.then(() => writeNow(path, content, ifMatch));
  const settled = run.then(() => null).catch(() => null);
  const forget = (): void => {
    if (chains.get(path) === settled) chains.delete(path);
  };
  chains.set(path, settled);
  void settled.then(forget);
  return run;
};

export const fileContent: {
  cap: number;
  fromBytes: typeof fromBytes;
  read: typeof read;
  write: typeof write;
} = { cap, fromBytes, read, write };
