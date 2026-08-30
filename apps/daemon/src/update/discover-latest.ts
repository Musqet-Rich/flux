import { guards, semver } from '@flux/protocol';

import type { FetchFn } from './fetch-release.ts';
import { defaultRepo } from './default-repo.ts';

// Discovers the newest PUBLISHED release version of the release repo (ADR 0021) from the GitHub
// Releases API: `GET /repos/<repo>/releases/latest` returns the newest release's `tag_name`, and
// that endpoint already excludes drafts and prereleases — so an unsigned draft is never offered.
// The version is the tag with a leading `v` stripped, validated with the shared semver guards.
// The injected `fetch` (the shared FetchFn) keeps this unit-tested against a fake, never the real
// network. Any non-200, network error, unparseable body, missing tag or non-semver tag yields
// null (offline / no release / API error); it never throws (engineering.md § TypeScript).

export interface DiscoverLatestDeps {
  fetch: FetchFn;
  repo?: string;
}

const stripV = (tag: string): string => (tag.startsWith('v') ? tag.slice(1) : tag);

const parseLatest = (body: string): string | null => {
  try {
    const value: unknown = JSON.parse(body);
    if (!guards.isRecord(value)) return null;
    const tag = value['tag_name'];
    if (!guards.isString(tag)) return null;
    const version = stripV(tag);
    return semver.isValid(version) ? version : null;
  } catch {
    return null;
  }
};

export const discoverLatest = async (deps: DiscoverLatestDeps): Promise<string | null> => {
  const repo = deps.repo ?? defaultRepo;
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const response = await deps.fetch(url);
    if (!response.ok) return null;
    return parseLatest(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer())));
  } catch {
    return null;
  }
};
