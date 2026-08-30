import { version } from '../version.ts';
import { checkUpdate } from './check-update.ts';
import type { CheckUpdateResult } from './check-update.ts';
import type { FetchFn } from './fetch-release.ts';

// The standalone `flux update --check` dry-run (ADR 0021/0022): discover the newest release and
// fetch+verify it WITHOUT applying, printing human-readable lines. It needs NO running daemon and
// NO control socket, so a fresh box can prove a release against the trusted keys before self-
// updating. Every effect is injected (the fetch and the log sink), so it is unit-tested with a
// fake fetch and no network. It never applies, never writes distDir and never runs fetched bytes.

export interface RunUpdateCheckDeps {
  distDir: string | null;
  fetch: FetchFn;
  repo?: string;
  // The running build to report as `current`; defaults to this daemon's version (tests override).
  current?: string;
  // Trusted keys override for tests only; the CLI leaves it unset so production verifies against
  // the vendored trusted set (never weaken trusted-keys.ts).
  keys?: string[];
  log: (line: string) => void;
}

const verdict = (result: CheckUpdateResult): string => {
  if (result.latest === null) {
    return 'could not determine the latest release (offline, no published release, or API error)';
  }
  if (result.available) {
    return result.verified === true
      ? `update available: ${result.latest} — verified ✓`
      : `update available: ${result.latest} — not verified: ${result.reason ?? 'unknown'}`;
  }
  if (result.reason === 'up_to_date') return `up to date (${result.current})`;
  if (result.reason === 'source_build') {
    return 'runs from source and cannot self-update';
  }
  return `latest ${result.latest} is below the 1.0.0 update floor`;
};

export const runUpdateCheck = async (deps: RunUpdateCheckDeps): Promise<void> => {
  const result = await checkUpdate({
    current: deps.current ?? version,
    distDir: deps.distDir,
    fetch: deps.fetch,
    ...(deps.repo === undefined ? {} : { repo: deps.repo }),
    ...(deps.keys === undefined ? {} : { keys: deps.keys }),
  });
  deps.log(`current ${result.current}`);
  deps.log(`latest ${result.latest ?? 'unknown'}`);
  deps.log(verdict(result));
};
