import type { ManualSection } from './manual.ts';

// A pure, dependency-free lookup over the bundled manual (manual.ts). Shared by every help surface:
// the `flux help` CLI, the `flux_help` MCP tool and the seeded Help Agent all call it, so the answer
// is identical wherever it is asked. No query returns an overview plus the list of topics; a query
// ranks sections by a transparent scorer — a match in the title outweighs a keyword match, which
// outweighs a body match — and returns the best few as plain text. Deterministic, no fuzzy search.

const TITLE_WEIGHT = 1000;
const KEYWORD_WEIGHT = 100;
const MAX_RESULTS = 3;

// Lowercase word tokens; single characters are dropped so `a`/`I` in a question do not match.
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 1);

// A query word matches a target word on equality or a shared prefix, so `pair` finds `pairing` and
// `session` finds `sessions` without a fuzzy-search dependency.
const matches = (query: string, targets: string[]): boolean =>
  targets.some(
    (target) => target === query || target.startsWith(query) || query.startsWith(target),
  );

const hits = (queryWords: string[], targets: string[]): number =>
  queryWords.filter((word) => matches(word, targets)).length;

const score = (section: ManualSection, queryWords: string[]): number => {
  const keywordWords = (section.keywords ?? []).flatMap((keyword) => words(keyword));
  return (
    hits(queryWords, words(section.title)) * TITLE_WEIGHT +
    hits(queryWords, keywordWords) * KEYWORD_WEIGHT +
    hits(queryWords, words(section.body))
  );
};

const renderSection = (section: ManualSection): string => `# ${section.title}\n\n${section.body}`;

const topics = (manual: ManualSection[]): string =>
  [
    'Topics — ask about any of these, e.g. `flux help pairing`:',
    ...manual.map((section) => `  - ${section.title}`),
  ].join('\n');

const overview = (manual: ManualSection[]): string => {
  const intro = manual.find((section) => section.title === 'Overview');
  return `${intro === undefined ? '' : `${intro.body}\n\n`}${topics(manual)}`;
};

// The best matches for a query, highest score first, ties keeping manual order (a stable sort).
const ranked = (manual: ManualSection[], queryWords: string[]): ManualSection[] =>
  manual
    .map((section, index) => ({ section, index, score: score(section, queryWords) }))
    .filter((entry) => entry.score > 0)
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.section);

export const helpLookup = (manual: ManualSection[], query?: string): string => {
  const queryWords = words(query ?? '');
  if (queryWords.length === 0) return overview(manual);
  const best = ranked(manual, queryWords);
  if (best.length === 0) {
    return `Nothing in the manual matched "${(query ?? '').trim()}".\n\n${topics(manual)}`;
  }
  return best.map((section) => renderSection(section)).join('\n\n');
};
