import type { RpcMethods } from '@flux/protocol';

import { discoverLatest } from './discover-latest.ts';
import type { FetchFn } from './fetch-release.ts';
import { fetchRelease } from './fetch-release.ts';
import { updateEligibility } from './update-eligibility.ts';
import { verifyManifest } from './verify-manifest.ts';

// Update discovery plus a verify-only dry-run (ADR 0021/0022), composed from the existing units:
// discover the newest published release, decide with the shared eligibility predicate whether it
// could be installed, and — only then — fetch and verify it WITHOUT applying. This path NEVER
// calls apply, NEVER writes to distDir and NEVER executes any fetched bytes: it only hashes and
// checks a signature. Production leaves `keys` unset so verifyManifest uses the vendored trusted
// set; tests inject an ephemeral key. Every side effect is the injected `fetch`, so the whole
// matrix is unit-tested with no network. Never throws (engineering.md § TypeScript).

export type CheckUpdateResult = RpcMethods['daemon.checkUpdate']['result'];

export interface CheckUpdateDeps {
  current: string;
  distDir: string | null;
  fetch: FetchFn;
  repo?: string;
  keys?: string[];
}

interface DryRun {
  verified: boolean;
  reason?: string;
}

const dryRun = async (deps: CheckUpdateDeps, latest: string): Promise<DryRun> => {
  const release = await fetchRelease(latest, {
    fetch: deps.fetch,
    ...(deps.repo === undefined ? {} : { repo: deps.repo }),
  });
  if (!release.ok) return { verified: false, reason: 'unreachable' };
  const verified = verifyManifest({
    manifest: release.manifest,
    signature: release.signature,
    files: release.files,
    ...(deps.keys === undefined ? {} : { keys: deps.keys }),
  });
  return verified.ok ? { verified: true } : { verified: false, reason: verified.reason };
};

export const checkUpdate = async (deps: CheckUpdateDeps): Promise<CheckUpdateResult> => {
  const latest = await discoverLatest({
    fetch: deps.fetch,
    ...(deps.repo === undefined ? {} : { repo: deps.repo }),
  });
  if (latest === null) {
    return {
      current: deps.current,
      latest: null,
      available: false,
      verified: null,
      reason: 'unreachable',
    };
  }
  const eligible = updateEligibility({
    distDir: deps.distDir,
    current: deps.current,
    target: latest,
  });
  if (!eligible.ok) {
    return {
      current: deps.current,
      latest,
      available: false,
      verified: null,
      reason: eligible.reason,
    };
  }
  const dry = await dryRun(deps, latest);
  return {
    current: deps.current,
    latest,
    available: true,
    verified: dry.verified,
    ...(dry.reason === undefined ? {} : { reason: dry.reason }),
  };
};
