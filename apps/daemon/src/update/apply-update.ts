import type { Ephemeral, UpdateFailReason } from '@flux/protocol';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FetchFn, FetchReleaseResult } from './fetch-release.ts';
import { fetchRelease } from './fetch-release.ts';
import type { VerifyResult } from './verify-manifest.ts';
import { verifyManifest } from './verify-manifest.ts';

// The self-update orchestrator (ADR 0022 § 3): fetch a signed release, verify it, atomically swap
// the running bundle, then stop and exit for the supervisor to restart into the new code. Every
// side effect is injected — fetch, ephemeral emit, the daemon's graceful stop, process exit, the
// install directory — so the whole path is unit-tested with an ephemeral signing key and no real
// network or process exit. ORDERING IS LOAD-BEARING: verify before any swap, all swaps before the
// exit, and never swap or exit on any failure. Never throws (engineering.md § TypeScript).

export interface ApplyUpdateDeps {
  target: string;
  fetch: FetchFn;
  emit: (data: Ephemeral) => void;
  // The daemon's bounded shutdown (ADR 0017); run before exit so in-flight agents stop first.
  stop: () => Promise<void>;
  exit: (code: number) => void;
  // The installed bundle directory (siblings of the running index.mjs); swaps land here.
  distDir: string;
  // Staging happens under here, then each file is renamed over its installed path.
  dataDir: string;
  // Trusted keys override for tests; defaults to the vendored set inside verifyManifest.
  keys?: string[];
  // Release repo override (`FLUX_RELEASE_REPO`); defaults to the constant in fetchRelease.
  repo?: string;
}

type VerifyFailReason = Extract<VerifyResult, { ok: false }>['reason'];

// A verifier reason maps onto the wire's failure reason: a malformed manifest reads as a bad
// download, while a bad signature or a bad hash are both a signature failure to the operator (the
// bytes are not what an offline key signed).
const mapVerifyReason = (reason: VerifyFailReason): UpdateFailReason =>
  reason === 'malformed' ? 'download_failed' : 'bad_signature';

// Write every verified file to a temp dir under the data dir, then rename each over its installed
// path. Rename is atomic within a filesystem, so a crash mid-swap leaves either the old or the new
// file, never a torn one; a file already renamed when a later one fails stays in place. Any fs
// error resolves false (a `disk_error`), and the staging dir is always cleaned up.
const installFiles = async (
  files: Map<string, Uint8Array>,
  distDir: string,
  dataDir: string,
): Promise<boolean> => {
  const staging = join(dataDir, `update-${randomUUID()}`);
  const staged = [...files].map(([name, bytes]) => ({ name, bytes, temp: join(staging, name) }));
  try {
    await mkdir(staging, { recursive: true });
    await Promise.all(staged.map((file) => writeFile(file.temp, file.bytes)));
    await Promise.all(staged.map((file) => rename(file.temp, join(distDir, file.name))));
    return true;
  } catch {
    return false;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {
      // A leftover staging dir costs a little disk until the next update cleans it; nothing else.
    });
  }
};

const fetched = (deps: ApplyUpdateDeps): Promise<FetchReleaseResult> =>
  fetchRelease(deps.target, {
    fetch: deps.fetch,
    ...(deps.repo === undefined ? {} : { repo: deps.repo }),
  });

export const applyUpdate = async (deps: ApplyUpdateDeps): Promise<void> => {
  deps.emit({ type: 'update.progress', phase: 'fetching' });
  const release = await fetched(deps);
  if (!release.ok) {
    deps.emit({ type: 'update.failed', reason: 'download_failed' });
    return;
  }

  deps.emit({ type: 'update.progress', phase: 'verifying' });
  const verified = verifyManifest({
    manifest: release.manifest,
    signature: release.signature,
    files: release.files,
    ...(deps.keys === undefined ? {} : { keys: deps.keys }),
  });
  if (!verified.ok) {
    deps.emit({ type: 'update.failed', reason: mapVerifyReason(verified.reason) });
    return;
  }
  if (verified.version !== deps.target) {
    deps.emit({ type: 'update.failed', reason: 'download_failed' });
    return;
  }

  deps.emit({ type: 'update.progress', phase: 'installing' });
  if (!(await installFiles(release.files, deps.distDir, deps.dataDir))) {
    deps.emit({ type: 'update.failed', reason: 'disk_error' });
    return;
  }

  deps.emit({ type: 'update.progress', phase: 'restarting' });
  await deps.stop();
  deps.exit(0);
};
