// Semantic-version comparison for the two sides that decide about a release (ADR 0021, ADR 0022):
// the daemon, asking whether an update target is newer than the running build and at or above the
// compat floor, and the PWA, asking whether the box has a newer version to offer. Parses `X.Y.Z`
// with an optional `-prerelease` tail; a version carrying a pre-release sorts below the same
// `X.Y.Z` release, so `0.0.0-dev` is below `0.0.0`. Hand-written, no dependency (engineering.md
// § Dependencies).

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  // The pre-release tail after the first `-`, or null for a release build; its presence lowers
  // precedence against the same core version.
  prerelease: string | null;
}

const pattern = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<pre>[0-9A-Za-z.-]+))?$/u;

const parse = (value: string): SemVer | null => {
  const groups = pattern.exec(value)?.groups;
  if (groups === undefined) return null;
  return {
    major: Number(groups['major']),
    minor: Number(groups['minor']),
    patch: Number(groups['patch']),
    prerelease: groups['pre'] ?? null,
  };
};

// A release (null pre-release) outranks the same core version with a pre-release; two pre-releases
// order by ASCII. `a === b` catches both null==null and identical strings.
const comparePre = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

const rank = (a: SemVer, b: SemVer): number => {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePre(a.prerelease, b.prerelease);
};

const isValid = (value: string): boolean => parse(value) !== null;

// `a` strictly newer than `b`; false if either is not a valid version, so a malformed string is
// never treated as an update.
const isNewer = (a: string, b: string): boolean => {
  const pa = parse(a);
  const pb = parse(b);
  if (pa === null || pb === null) return false;
  return rank(pa, pb) > 0;
};

// `value` at or above `floor` (the 1.0.0 compat floor for self-update); false if either is invalid.
const atLeast = (value: string, floor: string): boolean => {
  const pv = parse(value);
  const pf = parse(floor);
  if (pv === null || pf === null) return false;
  return rank(pv, pf) >= 0;
};

export const semver: {
  isValid: typeof isValid;
  isNewer: typeof isNewer;
  atLeast: typeof atLeast;
} = { isValid, isNewer, atLeast };
