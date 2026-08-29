import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { createMcpConfig } from './create-mcp-config.ts';

test('writes a per-session mcp config pointing at the flux-mcp entry', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'flux-mcp-cfg-'));
  const configFor = createMcpConfig({ dataDir, controlSocket: '/tmp/x.sock' });
  const path = configFor('s1');
  expect(path).toBe(join(dataDir, 'mcp', 's1.json'));
  const config: unknown = JSON.parse(await readFile(path, 'utf8'));
  expect(config).toEqual({
    mcpServers: {
      flux: {
        command: process.execPath,
        args: [expect.stringMatching(/flux-mcp\.(ts|mjs)$/u)],
        env: { FLUX_CONTROL_SOCKET: '/tmp/x.sock', FLUX_SESSION: 's1' },
      },
    },
  });
});
