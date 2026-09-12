import { expect, test } from 'vitest';

import { defaultRelayUrl } from './default-relay-url.ts';

// Pinned so a typo in the default relay can never silently send every fresh install (which sets no
// FLUX_RELAY_URL) to the wrong host: index.ts falls back to this when the env var is unset.
test('the default relay is the public relay', () => {
  expect(defaultRelayUrl).toBe('https://fluxagent.me');
});
