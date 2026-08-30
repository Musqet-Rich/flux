import { expect, test } from 'vitest';

import { pairingQr } from './pairing-qr.ts';

test('encodes a URL and renders it as a multi-line half-block block', () => {
  const out = pairingQr('https://flux.example.com/#abc.def', false);
  expect(out).toContain('█');
  expect(out.split('\n').length).toBeGreaterThan(1);
});
