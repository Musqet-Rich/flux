import { semver } from '@flux/protocol';

// The single predicate for "may this daemon install this release", shared by the apply path
// (`daemon.update`, create-update-handlers.ts) and the verify-only check (`daemon.checkUpdate`,
// check-update.ts) so the two never drift on the floor or the source-build rule (ADR 0022 § 4).
// `target` must already be valid semver (discovery guarantees it; the apply handler checks it
// first). Not-newer folds same-version and downgrades into `up_to_date`.

// The compat floor: self-update never installs a pre-1.0 build (ADR 0022 § 4). Kept module-private
// (one primary export per file); the apply handler states `1.0.0` in its refusal message.
const floor = '1.0.0';

export type Eligibility =
  | { ok: true }
  | { ok: false; reason: 'source_build' | 'below_floor' | 'up_to_date' };

export interface EligibilityInput {
  distDir: string | null;
  current: string;
  target: string;
}

export const updateEligibility = (input: EligibilityInput): Eligibility => {
  if (input.distDir === null) return { ok: false, reason: 'source_build' };
  if (!semver.atLeast(input.target, floor)) return { ok: false, reason: 'below_floor' };
  if (!semver.isNewer(input.target, input.current)) return { ok: false, reason: 'up_to_date' };
  return { ok: true };
};
