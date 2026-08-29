import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { createAgentConfig } from './create-agent-config.ts';
import { DaemonError } from './daemon-error.ts';

test('reads empty strings for missing files, writes whole files, keeps the other one', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'flux-claude-')), '.claude');
  const config = createAgentConfig(dir);
  expect(await config.read()).toEqual({ claudeMd: '', settingsJson: '' });
  expect(await config.write({ claudeMd: '# Rules\n' })).toEqual({
    claudeMd: '# Rules\n',
    settingsJson: '',
  });
  expect(await config.write({ settingsJson: '{"model":"opus"}' })).toEqual({
    claudeMd: '# Rules\n',
    settingsJson: '{"model":"opus"}',
  });
  expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe('{"model":"opus"}');
  expect(await config.write({})).toEqual(await config.read());
});

test('refuses settings.json that is not JSON and writes nothing', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'flux-claude-')), '.claude');
  const config = createAgentConfig(dir);
  await expect(config.write({ claudeMd: 'x', settingsJson: '{oops' })).rejects.toThrow(DaemonError);
  expect(await config.read()).toEqual({ claudeMd: '', settingsJson: '' });
});
