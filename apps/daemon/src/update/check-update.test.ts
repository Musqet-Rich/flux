import { generateKeyPairSync } from 'node:crypto';
import { expect, test } from 'vitest';

import { checkUpdate } from './check-update.ts';
import type { FetchFn, FetchResponse } from './fetch-release.ts';
import { signManifest } from './sign-manifest.ts';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const other = generateKeyPairSync('ed25519');

const inputs = [
  { name: 'index.mjs', bytes: enc('one') },
  { name: 'flux-mcp.mjs', bytes: enc('two') },
  { name: 'flux-pi-extension.mjs', bytes: enc('three') },
];

const api = 'https://api.github.com/repos/Musqet-Rich/flux/releases/latest';
const dl = (version: string, file: string): string =>
  `https://github.com/Musqet-Rich/flux/releases/download/v${version}/${file}`;

interface ReleaseOptions {
  version: string;
  key?: typeof privateKey;
  files?: { name: string; bytes: Uint8Array }[];
}

// A fake fetch that answers the discovery API with the release's tag and every download URL with
// the signed manifest, its base64 signature and the three files.
const serveRelease = (options: ReleaseOptions): FetchFn => {
  const files = options.files ?? inputs;
  const signed = signManifest(inputs, options.version, options.key ?? privateKey);
  const map = new Map<string, Uint8Array>([
    [api, enc(`{"tag_name":"v${options.version}"}`)],
    [dl(options.version, 'manifest.json'), signed.manifest],
    [
      dl(options.version, 'manifest.json.sig'),
      enc(`${Buffer.from(signed.signature).toString('base64')}\n`),
    ],
    ...files.map((f): [string, Uint8Array] => [dl(options.version, f.name), f.bytes]),
  ]);
  return (url) => {
    const bytes = map.get(url);
    const response: FetchResponse =
      bytes === undefined
        ? { ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }
        : { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(bytes)) };
    return Promise.resolve(response);
  };
};

const noRelease: FetchFn = () =>
  Promise.resolve({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });

// The discovery API answers with a tag, but every download URL 404s: an available release whose
// files cannot be fetched.
const serveApiOnly = (version: string): FetchFn => {
  const map = new Map<string, Uint8Array>([[api, enc(`{"tag_name":"v${version}"}`)]]);
  return (url) => {
    const bytes = map.get(url);
    const response: FetchResponse =
      bytes === undefined
        ? { ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }
        : { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(bytes)) };
    return Promise.resolve(response);
  };
};

test('an eligible, correctly signed release is available and verified', async () => {
  const result = await checkUpdate({
    current: '1.0.0',
    distDir: '/opt/flux/dist',
    fetch: serveRelease({ version: '1.2.0' }),
    keys: [pem],
  });
  expect(result).toEqual({ current: '1.0.0', latest: '1.2.0', available: true, verified: true });
});

test('a tampered file is available but not verified, reason bad_hash', async () => {
  const tampered = [
    { name: 'index.mjs', bytes: enc('one') },
    { name: 'flux-mcp.mjs', bytes: enc('tampered') },
    { name: 'flux-pi-extension.mjs', bytes: enc('three') },
  ];
  const result = await checkUpdate({
    current: '1.0.0',
    distDir: '/opt/flux/dist',
    fetch: serveRelease({ version: '1.2.0', files: tampered }),
    keys: [pem],
  });
  expect(result).toEqual({
    current: '1.0.0',
    latest: '1.2.0',
    available: true,
    verified: false,
    reason: 'bad_hash',
  });
});

test('a manifest signed by an untrusted key is not verified, reason bad_signature', async () => {
  const result = await checkUpdate({
    current: '1.0.0',
    distDir: '/opt/flux/dist',
    fetch: serveRelease({ version: '1.2.0', key: other.privateKey }),
    keys: [pem],
  });
  expect(result).toEqual({
    current: '1.0.0',
    latest: '1.2.0',
    available: true,
    verified: false,
    reason: 'bad_signature',
  });
});

test('a source build reports the latest but is not available, reason source_build', async () => {
  const result = await checkUpdate({
    current: '0.0.0-dev',
    distDir: null,
    fetch: serveRelease({ version: '1.2.0' }),
    keys: [pem],
  });
  expect(result).toEqual({
    current: '0.0.0-dev',
    latest: '1.2.0',
    available: false,
    verified: null,
    reason: 'source_build',
  });
});

test('a latest no newer than the running build is up_to_date and not available', async () => {
  const result = await checkUpdate({
    current: '2.0.0',
    distDir: '/opt/flux/dist',
    fetch: serveRelease({ version: '1.2.0' }),
    keys: [pem],
  });
  expect(result).toEqual({
    current: '2.0.0',
    latest: '1.2.0',
    available: false,
    verified: null,
    reason: 'up_to_date',
  });
});

test('a latest below the 1.0.0 floor is below_floor and not available', async () => {
  const result = await checkUpdate({
    current: '0.9.0',
    distDir: '/opt/flux/dist',
    fetch: serveRelease({ version: '0.9.5' }),
    keys: [pem],
  });
  expect(result).toEqual({
    current: '0.9.0',
    latest: '0.9.5',
    available: false,
    verified: null,
    reason: 'below_floor',
  });
});

test('an available release whose download fails is not verified, reason unreachable', async () => {
  const result = await checkUpdate({
    current: '1.0.0',
    distDir: '/opt/flux/dist',
    fetch: serveApiOnly('1.2.0'),
    keys: [pem],
  });
  expect(result).toEqual({
    current: '1.0.0',
    latest: '1.2.0',
    available: true,
    verified: false,
    reason: 'unreachable',
  });
});

test('no discoverable release leaves latest null and nothing verified', async () => {
  const result = await checkUpdate({
    current: '1.0.0',
    distDir: '/opt/flux/dist',
    fetch: noRelease,
    keys: [pem],
  });
  expect(result).toEqual({
    current: '1.0.0',
    latest: null,
    available: false,
    verified: null,
    reason: 'unreachable',
  });
});
