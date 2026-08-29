import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { createAgentCommands } from './create-agent-commands.ts';

test('resolves the agents present and the per-agent spawn options', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'flux-agent-commands-'));
  const config = createAgentCommands({
    dataDir,
    controlSocket: '/run/flux.sock',
    claudeCommand: 'sh',
    piCommand: 'no-such-binary-anywhere',
    piProvider: 'anthropic',
    piModel: 'claude-haiku-4-5',
  });
  expect(config.agents).toEqual(['claude']);
  expect(config.pool.claudeCommand).toBe('sh');
  expect(config.pool.pi).toEqual({
    sessionDir: join(dataDir, 'pi-sessions'),
    extension: expect.stringMatching(/flux-pi-extension\.ts$/u),
    command: 'no-such-binary-anywhere',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
  });
  expect(config.pool.mcpConfig?.('s1')).toBe(join(dataDir, 'mcp', 's1.json'));
  expect(config.pool.env?.('s1')).toMatchObject({
    FLUX_CONTROL_SOCKET: '/run/flux.sock',
    FLUX_SESSION: 's1',
  });
});

test('leaves unset options out so the binaries and pi settings decide', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'flux-agent-commands-'));
  const config = createAgentCommands({ dataDir, controlSocket: '/run/flux.sock' });
  expect(config.pool.claudeCommand).toBeUndefined();
  expect(config.pool.pi).toEqual({
    sessionDir: join(dataDir, 'pi-sessions'),
    extension: expect.stringMatching(/flux-pi-extension\.ts$/u),
  });
});

test('forget removes the pi session file of an archived session and nothing else', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'flux-agent-commands-'));
  const slug = join(dataDir, 'pi-sessions', '--home-flux-repos-app--');
  mkdirSync(slug, { recursive: true });
  const mine = join(slug, '2026-08-29T13-18-58-743Z_s1.jsonl');
  const other = join(slug, '2026-08-29T13-19-01-154Z_s2.jsonl');
  writeFileSync(mine, '{}\n');
  writeFileSync(other, '{}\n');
  const commands = createAgentCommands({ dataDir, controlSocket: '/run/flux.sock' });
  commands.forget('s1');
  expect(existsSync(mine)).toBe(false);
  expect(existsSync(other)).toBe(true);
  commands.forget('s3');
  createAgentCommands({ dataDir: join(dataDir, 'none'), controlSocket: '/s' }).forget('s1');
});
