// Fetches one release's assets from GitHub Releases (ADR 0022 § 1): the signed manifest, its
// detached signature, and the three bundle files. Every side effect is the injected `fetch`, so
// the orchestrator is unit-tested with a fake that returns bytes and no network is touched. Any
// non-200 or network error yields `{ ok: false }` (a `download_failed` to the caller); this never
// throws. The repo slug is a constant, overridable by `FLUX_RELEASE_REPO` for tests.

import { defaultRepo } from './default-repo.ts';

export interface FetchResponse {
  ok: boolean;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export type FetchFn = (url: string) => Promise<FetchResponse>;

export interface FetchReleaseDeps {
  fetch: FetchFn;
  repo?: string;
}

export type FetchReleaseResult =
  | { ok: true; manifest: Uint8Array; signature: Uint8Array; files: Map<string, Uint8Array> }
  | { ok: false };

// The three files that get swapped over the installed bundle; the manifest lists exactly these.
const bundleFiles = ['index.mjs', 'flux-mcp.mjs', 'flux-pi-extension.mjs'];

const fetchBytes = async (fetch: FetchFn, url: string): Promise<Uint8Array | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
};

// The `.sig` asset is the raw 64-byte ed25519 signature, base64-encoded with a trailing newline
// (docs/releases.md). Buffer decoding is lenient, so a malformed signature simply fails to verify
// as `bad_signature` rather than being caught here.
const decodeSignature = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(Buffer.from(new TextDecoder().decode(bytes).trim(), 'base64'));

export const fetchRelease = async (
  version: string,
  deps: FetchReleaseDeps,
): Promise<FetchReleaseResult> => {
  const repo = deps.repo ?? defaultRepo;
  const base = `https://github.com/${repo}/releases/download/v${version}`;
  const manifestP = fetchBytes(deps.fetch, `${base}/manifest.json`);
  const signatureP = fetchBytes(deps.fetch, `${base}/manifest.json.sig`);
  const filesP = Promise.all(
    bundleFiles.map(async (name) => ({
      name,
      bytes: await fetchBytes(deps.fetch, `${base}/${name}`),
    })),
  );
  const manifest = await manifestP;
  const signatureBytes = await signatureP;
  const fetched = await filesP;
  if (manifest === null || signatureBytes === null) return { ok: false };
  const files = new Map<string, Uint8Array>();
  for (const file of fetched) {
    if (file.bytes === null) return { ok: false };
    files.set(file.name, file.bytes);
  }
  return { ok: true, manifest, signature: decodeSignature(signatureBytes), files };
};
