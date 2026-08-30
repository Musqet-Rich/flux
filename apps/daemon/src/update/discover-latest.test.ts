import { expect, test } from 'vitest';

import { discoverLatest } from './discover-latest.ts';
import type { FetchFn, FetchResponse } from './fetch-release.ts';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const ok = (body: string): FetchResponse => ({
  ok: true,
  arrayBuffer: () => Promise.resolve(toArrayBuffer(enc(body))),
});
const notFound: FetchResponse = {
  ok: false,
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
};

const serve =
  (response: FetchResponse): FetchFn =>
  () =>
    Promise.resolve(response);

const throwing: FetchFn = () => Promise.reject(new Error('offline'));

test('parses the tag_name of the latest release and strips a leading v', async () => {
  const result = await discoverLatest({ fetch: serve(ok('{"tag_name":"v1.4.0"}')) });
  expect(result).toBe('1.4.0');
});

test('accepts a tag without a leading v', async () => {
  const result = await discoverLatest({ fetch: serve(ok('{"tag_name":"2.0.1"}')) });
  expect(result).toBe('2.0.1');
});

test('a non-200 (no published release) is null', async () => {
  expect(await discoverLatest({ fetch: serve(notFound) })).toBeNull();
});

test('a non-JSON body is null, never a throw', async () => {
  expect(await discoverLatest({ fetch: serve(ok('not json {')) })).toBeNull();
});

test('a missing tag_name is null', async () => {
  expect(await discoverLatest({ fetch: serve(ok('{"name":"1.0.0"}')) })).toBeNull();
});

test('a non-string tag_name is null', async () => {
  expect(await discoverLatest({ fetch: serve(ok('{"tag_name":7}')) })).toBeNull();
});

test('a tag that is not valid semver is null', async () => {
  expect(await discoverLatest({ fetch: serve(ok('{"tag_name":"latest"}')) })).toBeNull();
});

test('a network error is null, never a throw', async () => {
  expect(await discoverLatest({ fetch: throwing })).toBeNull();
});

test('the repo override steers the discovery URL', async () => {
  const urls: string[] = [];
  const spy: FetchFn = (url) => {
    urls.push(url);
    return Promise.resolve(ok('{"tag_name":"v1.0.0"}'));
  };
  await discoverLatest({ fetch: spy, repo: 'acme/flux' });
  expect(urls).toEqual(['https://api.github.com/repos/acme/flux/releases/latest']);
});
