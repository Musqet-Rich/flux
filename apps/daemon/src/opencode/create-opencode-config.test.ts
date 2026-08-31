import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';

import { createOpencodeConfig } from './create-opencode-config.ts';

// The floor + role are injected entirely out of the worktree (ADR 0027 § 4/§ 5): a config under
// the data dir declares the `flux` local MCP server and points opencode at an absolute
// instructions file, so opencode's cwd-based discovery finds nothing and the worktree's git
// state stays clean. Verified headlessly with `opencode mcp list` connecting to the same server.

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'flux-oc-cfg-'));
  const write = createOpencodeConfig({ dataDir, controlSocket: '/run/flux.sock' });
  return { dataDir, write };
};

interface Config {
  instructions: string[];
  mcp: {
    flux: {
      type: string;
      command: string[];
      environment: Record<string, string>;
      enabled: boolean;
    };
  };
}

test('the config declares the flux MCP server with the socket and session in its env', () => {
  const { dataDir, write } = setup();
  const path = write('s1');
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
  const { flux } = config.mcp;
  expect(flux.type).toBe('local');
  expect(flux.enabled).toBe(true);
  expect(flux.environment).toEqual({ FLUX_CONTROL_SOCKET: '/run/flux.sock', FLUX_SESSION: 's1' });
  expect(flux.command[0]).toBe(process.execPath);
  expect(flux.command[1]).toMatch(/flux-mcp\.(ts|mjs)$/u);
  // The config lives under the data dir, never in the worktree: the anti-pollution mechanism.
  expect(dirname(path)).toBe(join(dataDir, 'opencode'));
});

test('the instructions file carries the flux prompt, then the role appended after it', () => {
  const { dataDir, write } = setup();
  write('s2', 'You write terse TypeScript.');
  const instructions = readFileSync(join(dataDir, 'opencode', 's2.md'), 'utf8');
  expect(instructions).toMatch(/flux_ask/u);
  expect(instructions).toMatch(/\n\nYou write terse TypeScript\.$/u);
});

test('with no role the instructions are the flux prompt alone', () => {
  const { dataDir, write } = setup();
  write('s3');
  const instructions = readFileSync(join(dataDir, 'opencode', 's3.md'), 'utf8');
  expect(instructions).toMatch(/flux_ask/u);
  expect(instructions).not.toMatch(/\n\n/u);
});

test('the config points opencode at the absolute instructions path', () => {
  const { dataDir, write } = setup();
  const path = write('s4', 'role');
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
  expect(config.instructions).toEqual([join(dataDir, 'opencode', 's4.md')]);
});
