import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import type { ServiceInput } from './build-service-config.ts';
import { runServiceCli } from './run-service-cli.ts';

const input: ServiceInput = {
  platform: 'linux',
  hasSystemd: false,
  isRoot: false,
  user: 'node',
  home: '/home/node',
  node: '/usr/local/bin/node',
  entry: '/workspace/flux/apps/daemon/dist/index.mjs',
  dataDir: '/workspace/.flux',
  env: {},
};

test('wires the real filesystem io: read-only status on an empty data dir', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'flux-svc-cli-'));
  const lines = await runServiceCli('status', { ...input, dataDir });
  expect(lines[0]).toBe(
    `restart-loop wrapper ${join(dataDir, 'flux-daemon-run.sh')}: not installed`,
  );
});
