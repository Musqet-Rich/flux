// The branch name a new session starts with: `flux/<local date>-<4 random chars>`. The date is
// the operator's, not UTC, so a late-evening session is filed under the day they are living in.
// The suffix is what lets several sessions start on the same day: the daemon reuses a branch
// that already exists, and git then refuses to check it out into a second worktree while the
// first is there, or, once that worktree is gone, silently starts the new session on the old
// branch's tip. Four characters from 36 give about 1.7M names a day (the `% 36` skew towards
// `a`–`d` costs under 1%, not worth rejection sampling), and the field stays editable. `now` and
// `bytes` are injected so tests are deterministic.

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const suffixLength = 4;

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

const pad = (n: number): string => String(n).padStart(2, '0');

const localDate = (now: Date): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const defaultBranch = (
  now: Date = new Date(),
  bytes: (length: number) => Uint8Array = randomBytes,
): string => {
  const suffix = Array.from(bytes(suffixLength), (b) => alphabet.charAt(b % alphabet.length));
  return `flux/${localDate(now)}-${suffix.join('')}`;
};
