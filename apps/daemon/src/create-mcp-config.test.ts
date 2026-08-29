import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { createMcpConfig } from './create-mcp-config.ts';

test('writes a per-session mcp config pointing at the flux-mcp entry', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'flux-mcp-cfg-'));
  const configFor = createMcpConfig({ dataDir, controlSocket: '/tmp/x.sock' });
  const path = configFor('s1');
  expect(path).toBe(join(dataDir, 'mcp', 's1.json'));
  const config: unknown = JSON.parse(await readFile(path, 'utf8'));
  // Under Vitest this module is the .ts source, so the entry is the .ts sibling (the built
  // daemon's .mjs sibling is covered by test/built-daemon.test.ts). It must exist.
  const entry = fileURLToPath(new URL('./flux-mcp.ts', import.meta.url));
  await access(entry);
  expect(config).toEqual({
    mcpServers: {
      flux: {
        command: process.execPath,
        args: [entry],
        env: { FLUX_CONTROL_SOCKET: '/tmp/x.sock', FLUX_SESSION: 's1' },
      },
    },
  });
});
