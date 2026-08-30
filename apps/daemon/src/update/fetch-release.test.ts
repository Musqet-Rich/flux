import { expect, test } from 'vitest';

import type { FetchFn, FetchResponse } from './fetch-release.ts';
import { fetchRelease } from './fetch-release.ts';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const assets = new Map<string, Uint8Array>([
  ['manifest.json', enc('{"version":"1.2.3"}')],
  ['manifest.json.sig', enc(`${Buffer.from(enc('sig')).toString('base64')}\n`)],
  ['index.mjs', enc('a')],
  ['flux-mcp.mjs', enc('b')],
  ['flux-pi-extension.mjs', enc('c')],
]);

const serve =
  (map: Map<string, Uint8Array>): FetchFn =>
  (url) => {
    const bytes = map.get(url.slice(url.lastIndexOf('/') + 1));
    const response: FetchResponse =
      bytes === undefined
        ? { ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }
        : { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(bytes)) };
    return Promise.resolve(response);
  };

const throwing: FetchFn = () => Promise.reject(new Error('offline'));

test('fetches the five assets and decodes the base64 signature', async () => {
  const result = await fetchRelease('1.2.3', { fetch: serve(assets) });
  expect(result).toEqual({
    ok: true,
    manifest: enc('{"version":"1.2.3"}'),
    signature: enc('sig'),
    files: new Map([
      ['index.mjs', enc('a')],
      ['flux-mcp.mjs', enc('b')],
      ['flux-pi-extension.mjs', enc('c')],
    ]),
  });
});

test('a missing asset makes the whole fetch fail', async () => {
  const partial = new Map(assets);
  partial.delete('flux-pi-extension.mjs');
  const result = await fetchRelease('1.2.3', { fetch: serve(partial) });
  expect(result).toEqual({ ok: false });
});

test('a missing manifest signature makes the fetch fail', async () => {
  const partial = new Map(assets);
  partial.delete('manifest.json.sig');
  const result = await fetchRelease('1.2.3', { fetch: serve(partial) });
  expect(result).toEqual({ ok: false });
});

test('a network error is a failed fetch, never a throw', async () => {
  const result = await fetchRelease('1.2.3', { fetch: throwing });
  expect(result).toEqual({ ok: false });
});

test('the repo override steers the download URL', async () => {
  const urls: string[] = [];
  const spy: FetchFn = (url) => {
    urls.push(url);
    return serve(assets)(url);
  };
  await fetchRelease('1.2.3', { fetch: spy, repo: 'acme/flux' });
  expect(urls).toContain('https://github.com/acme/flux/releases/download/v1.2.3/manifest.json');
});
