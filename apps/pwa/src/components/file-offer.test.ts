import type { Attachment } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';

import type { FetchFile } from './event-view.ts';
import FileOffer from './FileOffer.vue';

// The download card for a file the agent offered (ADR 0036). The fetch is the parent's (the
// store's `fetchAttachment`), so here it is a function the test settles by hand; the save is an
// `<a download>` click, watched on the prototype; Share depends on what the browser says it can
// share, stubbed per test.

const pdf: Attachment = {
  id: 'f-1',
  name: 'report.pdf',
  mime: 'application/pdf',
  size: 2048,
  image: false,
};

const unreported = (_fraction: number): void => {};

// Each call to the stubbed `navigator.share` rejects with the next of `outcomes`.
const rejecting = (outcomes: DOMException[]) => (): Promise<void> => {
  const next = outcomes.shift();
  return next === undefined ? Promise.resolve() : Promise.reject(next);
};

// A fetch the test resolves or rejects when it chooses, reporting progress on the way.
const controlled = () => {
  const calls: Attachment[] = [];
  let settle: { resolve: (b: Blob) => void; reject: (e: Error) => void } | null = null;
  let report = unreported;
  const fetchFile: FetchFile = (a, onProgress) => {
    calls.push(a);
    report = onProgress;
    return new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
  };
  return {
    fetchFile,
    calls,
    progress: (fraction: number) => {
      report(fraction);
    },
    resolve: (blob: Blob) => {
      settle?.resolve(blob);
    },
    reject: (message: string) => {
      settle?.reject(new Error(message));
    },
  };
};

const mountCard = (fetchFile: FetchFile, note = '', thumb: string | null = null) =>
  mount(FileOffer, { props: { file: pdf, note, thumb, fetchFile }, attachTo: document.body });

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

test('shows the name, size and note, with a file icon when there is no thumbnail', () => {
  const card = mountCard(controlled().fetchFile, 'The quarterly figures');
  expect(card.find('.name').text()).toBe('report.pdf');
  expect(card.find('.size').text()).toBe('2.0 KiB');
  expect(card.find('.note').text()).toBe('The quarterly figures');
  expect(card.find('.thumb').exists()).toBe(false);
  expect(card.find('.icon').exists()).toBe(true);
  card.unmount();
});

test('an image shows its thumbnail; no note means no note line', () => {
  const card = mountCard(controlled().fetchFile, '', 'blob:thumb');
  expect(card.find('.thumb').attributes('src')).toBe('blob:thumb');
  expect(card.find('.note').exists()).toBe(false);
  card.unmount();
});

test('Download fetches with progress, then saves through an <a download> on a blob URL', async () => {
  const fetch = controlled();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const clicked = () =>
    click.mock.contexts.map((a) => {
      const link = a as HTMLAnchorElement;
      return { href: link.href, download: link.download };
    });
  const card = mountCard(fetch.fetchFile);
  await card.find('.download').trigger('click');
  expect(fetch.calls).toEqual([pdf]);
  fetch.progress(0.5);
  await flushPromises();
  expect(card.find('.progress').text()).toContain('50%');
  expect(card.find('.download').attributes('disabled')).toBeDefined();
  fetch.resolve(new Blob(['%PDF'], { type: 'application/pdf' }));
  await flushPromises();
  expect(card.find('.progress').exists()).toBe(false);
  expect(clicked()).toEqual([{ href: expect.stringMatching(/^blob:/u), download: 'report.pdf' }]);
  // The bytes are kept: a second Download saves again without fetching again.
  await card.find('.download').trigger('click');
  await flushPromises();
  expect(fetch.calls).toHaveLength(1);
  expect(clicked()).toHaveLength(2);
  card.unmount();
});

test('a failed fetch shows why with Retry, which fetches again', async () => {
  const fetch = controlled();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const card = mountCard(fetch.fetchFile);
  await card.find('.download').trigger('click');
  fetch.reject('the box is offline');
  await flushPromises();
  expect(card.find('.error').text()).toContain('Could not get the file: the box is offline');
  await card.find('.retry').trigger('click');
  expect(fetch.calls).toHaveLength(2);
  expect(card.find('.error').exists()).toBe(false);
  fetch.resolve(new Blob(['x']));
  await flushPromises();
  expect(card.find('.error').exists()).toBe(false);
  card.unmount();
});

test('no Share where the browser cannot share files', () => {
  const card = mountCard(controlled().fetchFile);
  expect(card.find('.share').exists()).toBe(false);
  card.unmount();
});

test('Share hands the file to the share sheet where the browser can share it', async () => {
  const fetch = controlled();
  const shared: File[][] = [];
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', {
    value: (data: { files: File[] }) => {
      shared.push(data.files);
      return Promise.resolve();
    },
    configurable: true,
  });
  const card = mountCard(fetch.fetchFile);
  await card.find('.share').trigger('click');
  fetch.resolve(new Blob(['%PDF']));
  await flushPromises();
  expect(shared.map((files) => files.map((f) => [f.name, f.type]))).toEqual([
    [['report.pdf', 'application/pdf']],
  ]);
  expect(card.find('.error').exists()).toBe(false);
  card.unmount();
});

test('a share sheet that needs another tap says so; a cancelled one is no error', async () => {
  const fetch = controlled();
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', {
    value: rejecting([
      new DOMException('no activation', 'NotAllowedError'),
      new DOMException('cancelled', 'AbortError'),
    ]),
    configurable: true,
  });
  const card = mountCard(fetch.fetchFile);
  await card.find('.share').trigger('click');
  fetch.resolve(new Blob(['%PDF']));
  await flushPromises();
  expect(card.find('.error').text()).toContain('Tap Share again');
  await card.find('.retry').trigger('click');
  await flushPromises();
  expect(card.find('.error').exists()).toBe(false);
  expect(fetch.calls).toHaveLength(1);
  card.unmount();
});
