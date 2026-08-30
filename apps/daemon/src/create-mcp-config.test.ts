import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { createMcpConfig } from './create-mcp-config.ts';

// Under Vitest this module is the .ts source, so the entries are the .ts siblings (the built
// daemon's .mjs siblings are covered by test/built-daemon.test.ts). They must exist.
const fluxEntry = fileURLToPath(new URL('./flux-mcp.ts', import.meta.url));
const managerEntry = fileURLToPath(new URL('./flux-manager-mcp.ts', import.meta.url));

const fluxServer = {
  command: process.execPath,
  args: [fluxEntry],
  env: { FLUX_CONTROL_SOCKET: '/tmp/x.sock', FLUX_SESSION: 's1' },
};

test('a non-manager session gets a single flux server, byte-identical to today', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'flux-mcp-cfg-'));
  const configFor = createMcpConfig({ dataDir, controlSocket: '/tmp/x.sock' });
  const path = configFor('s1', false);
  expect(path).toBe(join(dataDir, 'mcp', 's1.json'));
  const raw = await readFile(path, 'utf8');
  await access(fluxEntry);
  expect(JSON.parse(raw)).toEqual({ mcpServers: { flux: fluxServer } });
  // Byte-identical to the pre-ADR-0025 shape: a single `flux` server, no `flux-manager` key.
  expect(raw).toBe(`${JSON.stringify({ mcpServers: { flux: fluxServer } }, null, 2)}\n`);
});

test('a manager session also gets the flux-manager server', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'flux-mcp-cfg-'));
  const configFor = createMcpConfig({ dataDir, controlSocket: '/tmp/x.sock' });
  const config: unknown = JSON.parse(await readFile(configFor('s1', true), 'utf8'));
  await access(managerEntry);
  expect(config).toEqual({
    mcpServers: {
      flux: fluxServer,
      'flux-manager': {
        command: process.execPath,
        args: [managerEntry],
        env: { FLUX_CONTROL_SOCKET: '/tmp/x.sock', FLUX_SESSION: 's1' },
      },
    },
  });
});
