import { generateKeyPairSync } from 'node:crypto';
import { expect, test } from 'vitest';

import type { FetchFn, FetchResponse } from './fetch-release.ts';
import { runUpdateCheck } from './run-update-check.ts';
import { signManifest } from './sign-manifest.ts';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });

const inputs = [
  { name: 'index.mjs', bytes: enc('one') },
  { name: 'flux-mcp.mjs', bytes: enc('two') },
  { name: 'flux-pi-extension.mjs', bytes: enc('three') },
];

const api = 'https://api.github.com/repos/Musqet-Rich/flux/releases/latest';
const dl = (version: string, file: string): string =>
  `https://github.com/Musqet-Rich/flux/releases/download/v${version}/${file}`;

const serveRelease = (version: string): FetchFn => {
  const signed = signManifest(inputs, version, privateKey);
  const map = new Map<string, Uint8Array>([
    [api, enc(`{"tag_name":"v${version}"}`)],
    [dl(version, 'manifest.json'), signed.manifest],
    [
      dl(version, 'manifest.json.sig'),
      enc(`${Buffer.from(signed.signature).toString('base64')}\n`),
    ],
    ...inputs.map((f): [string, Uint8Array] => [dl(version, f.name), f.bytes]),
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

const collect = async (deps: Parameters<typeof runUpdateCheck>[0]): Promise<string[]> => {
  const lines: string[] = [];
  await runUpdateCheck({
    ...deps,
    log: (line) => {
      lines.push(line);
    },
  });
  return lines;
};

test('prints current, latest and a verified verdict for an available signed release', async () => {
  const lines = await collect({
    current: '1.0.0',
    distDir: '/opt/flux/dist',
    fetch: serveRelease('1.2.0'),
    keys: [pem],
    log: () => {},
  });
  expect(lines).toEqual(['current 1.0.0', 'latest 1.2.0', 'update available: 1.2.0 — verified ✓']);
});

test('prints an up-to-date verdict when the latest is not newer', async () => {
  const lines = await collect({
    current: '2.0.0',
    distDir: '/opt/flux/dist',
    fetch: serveRelease('1.2.0'),
    keys: [pem],
    log: () => {},
  });
  expect(lines).toEqual(['current 2.0.0', 'latest 1.2.0', 'up to date (2.0.0)']);
});

test('prints an unknown latest and a could-not-determine verdict when unreachable', async () => {
  const lines = await collect({
    current: '1.0.0',
    distDir: '/opt/flux/dist',
    fetch: noRelease,
    keys: [pem],
    log: () => {},
  });
  expect(lines).toEqual([
    'current 1.0.0',
    'latest unknown',
    'could not determine the latest release (offline, no published release, or API error)',
  ]);
});
