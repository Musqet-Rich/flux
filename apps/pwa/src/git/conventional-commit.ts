import type { Commit } from '@flux/protocol';

// Conventional Commits as the repo's `commits` check reads them (engineering.md § Git):
// `type(scope)?!?: subject`, the whole line at most 100 characters. The PR title is judged by
// the same rule because PRs are squash-merged and the squash commit takes the title. The scope
// is left open here: other repositories have their own lists, and the hint is only a hint.

const types = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'ci', 'build', 'perf', 'style'];
const pattern = new RegExp(`^(${types.join('|')})(\\([^()\\s]+\\))?!?: \\S.*$`, 'u');
const maxLength = 100;

const matches = (subject: string): boolean => subject.length <= maxLength && pattern.test(subject);

// The commit whose subject should seed the PR title: the newest that parses, else the newest.
// `commits` is newest first, as `git.log` returns them.
const latest = (commits: readonly Commit[]): Commit | null =>
  commits.find((c) => matches(c.subject)) ?? commits[0] ?? null;

export const conventionalCommit = { matches, latest };
