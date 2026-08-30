import { expect, test } from 'vitest';

import type { ServiceConfig } from './build-service-config.ts';
import { renderWrapperScript } from './render-wrapper-script.ts';

const config: ServiceConfig = {
  host: 'wrapper',
  isRoot: false,
  user: 'node',
  home: '/home/node',
  node: '/usr/local/bin/node',
  entry: '/workspace/flux/apps/daemon/dist/index.mjs',
  dataDir: '/workspace/.flux',
  env: { FLUX_RELAY_URL: 'https://flux.example.com', PATH: '/usr/bin' },
};

test('renders a restart loop that exports the environment and re-runs the daemon', () => {
  const script = renderWrapperScript(config);
  expect(script.startsWith('#!/bin/sh\n')).toBe(true);
  expect(script).toContain('set -eu');
  expect(script).toContain("export FLUX_RELAY_URL='https://flux.example.com'");
  expect(script).toContain("export PATH='/usr/bin'");
  expect(script).toContain('while true; do');
  expect(script).toContain(
    "  '/usr/local/bin/node' '/workspace/flux/apps/daemon/dist/index.mjs' daemon || true",
  );
  expect(script).toContain('  sleep 1');
  expect(script).toContain('done');
});

test('escapes single quotes in shell values so quoting cannot be broken out of', () => {
  const script = renderWrapperScript({ ...config, env: { FLUX_X: "a'b" } });
  expect(script).toContain("export FLUX_X='a'\\''b'");
});
