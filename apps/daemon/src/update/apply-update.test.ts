import type { Ephemeral } from '@flux/protocol';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { applyUpdate } from './apply-update.ts';
import type { ApplyUpdateDeps } from './apply-update.ts';
import type { FetchFn, FetchResponse } from './fetch-release.ts';
import { signManifest } from './sign-manifest.ts';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const bundle = ['index.mjs', 'flux-mcp.mjs', 'flux-pi-extension.mjs'];
const newBytes = (name: string): Uint8Array => enc(`new ${name}`);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trusted = [publicKey.export({ type: 'spki', format: 'pem' })];

// A release's five assets by filename, as the fake fetch serves them. `version` signs the
// manifest; `mutate` lets a test tamper a file's served bytes without changing the signed hash.
const releaseAssets = (
  version: string,
  mutate: (files: Map<string, Uint8Array>) => void,
): Map<string, Uint8Array> => {
  const inputs = bundle.map((name) => ({ name, bytes: newBytes(name) }));
  const signed = signManifest(inputs, version, privateKey);
  const served = new Map<string, Uint8Array>(inputs.map((f) => [f.name, f.bytes]));
  mutate(served);
  served.set('manifest.json', signed.manifest);
  served.set('manifest.json.sig', enc(`${Buffer.from(signed.signature).toString('base64')}\n`));
  return served;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

// A short label per emitted ephemeral, so a test asserts the exact phase order in one array.
const label = (data: Ephemeral): string => {
  if (data.type === 'update.progress') return data.phase;
  if (data.type === 'update.failed') return `failed:${data.reason}`;
  return data.type;
};

const fakeFetch =
  (assets: Map<string, Uint8Array>): FetchFn =>
  (url) => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    const bytes = assets.get(name);
    const response: FetchResponse =
      bytes === undefined
        ? { ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }
        : { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(bytes)) };
    return Promise.resolve(response);
  };

interface Harness {
  deps: ApplyUpdateDeps;
  events: string[];
  emitted: Ephemeral[];
  distDir: string;
}

const dirs: string[] = [];
afterEach(() => {
  dirs.length = 0;
});

const harness = async (target: string, assets: Map<string, Uint8Array>): Promise<Harness> => {
  const distDir = await mkdtemp(join(tmpdir(), 'flux-dist-'));
  dirs.push(distDir);
  await Promise.all(bundle.map((name) => writeFile(join(distDir, name), enc(`old ${name}`))));
  const events: string[] = [];
  const emitted: Ephemeral[] = [];
  const deps: ApplyUpdateDeps = {
    target,
    fetch: fakeFetch(assets),
    emit: (data) => {
      emitted.push(data);
      events.push(label(data));
    },
    stop: () => {
      events.push('stop');
      return Promise.resolve();
    },
    exit: () => {
      events.push('exit');
    },
    distDir,
    keys: trusted,
  };
  return { deps, events, emitted, distDir };
};

test('the happy path fetches, verifies, installs, swaps the files, then stops and exits', async () => {
  const { deps, events, distDir } = await harness(
    '1.2.3',
    releaseAssets('1.2.3', () => {}),
  );
  await applyUpdate(deps);
  expect(events).toEqual(['fetching', 'verifying', 'installing', 'restarting', 'stop', 'exit']);
  const installed = await Promise.all(bundle.map((name) => readFile(join(distDir, name), 'utf8')));
  expect(installed).toEqual(bundle.map((name) => `new ${name}`));
});

test('stages inside distDir and renames within it, leaving no staging behind', async () => {
  // Regression for the cross-filesystem swap: staging must sit beside the installed files so every
  // rename stays on one mount (fs.rename throws EXDEV across mounts). The only directory apply-update
  // is given is distDir; a successful swap that leaves distDir holding exactly the bundle — no
  // `.update-*` staging dir — proves staging happened here and was cleaned up, not on a data mount.
  const { deps, distDir } = await harness(
    '1.2.3',
    releaseAssets('1.2.3', () => {}),
  );
  await applyUpdate(deps);
  const installed = await Promise.all(bundle.map((name) => readFile(join(distDir, name), 'utf8')));
  expect(installed).toEqual(bundle.map((name) => `new ${name}`));
  const entries = await readdir(distDir);
  expect(entries.toSorted()).toEqual([...bundle].toSorted());
});

test('a fetch failure reports download_failed and never swaps or exits', async () => {
  const assets = releaseAssets('1.2.3', (files) => {
    files.delete('flux-mcp.mjs');
  });
  const { deps, events, distDir } = await harness('1.2.3', assets);
  await applyUpdate(deps);
  expect(events).toEqual(['fetching', 'failed:download_failed']);
  const untouched = await readFile(join(distDir, 'index.mjs'), 'utf8');
  expect(untouched).toBe('old index.mjs');
});

test('a tampered file reports bad_signature and never swaps or exits', async () => {
  const assets = releaseAssets('1.2.3', (files) => {
    files.set('flux-mcp.mjs', enc('tampered'));
  });
  const { deps, events, distDir } = await harness('1.2.3', assets);
  await applyUpdate(deps);
  expect(events).toEqual(['fetching', 'verifying', 'failed:bad_signature']);
  const untouched = await readFile(join(distDir, 'flux-mcp.mjs'), 'utf8');
  expect(untouched).toBe('old flux-mcp.mjs');
});

test('a manifest for a different version reports download_failed and never swaps', async () => {
  const { deps, events, distDir } = await harness(
    '1.2.3',
    releaseAssets('2.0.0', () => {}),
  );
  await applyUpdate(deps);
  expect(events).toEqual(['fetching', 'verifying', 'failed:download_failed']);
  const untouched = await readFile(join(distDir, 'index.mjs'), 'utf8');
  expect(untouched).toBe('old index.mjs');
});
