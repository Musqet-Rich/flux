import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
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

test('refuses settings.json that is not a JSON object and writes nothing', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'flux-claude-')), '.claude');
  const config = createAgentConfig(dir);
  await expect(config.write({ claudeMd: 'x', settingsJson: '{oops' })).rejects.toThrow(DaemonError);
  for (const bad of ['null', '[]', '"str"', '42', '']) {
    expect(() => {
      config.check({ settingsJson: bad });
    }).toThrow('JSON object');
  }
  config.check({ settingsJson: '{}' });
  config.check({ claudeMd: 'anything' });
  expect(await config.read()).toEqual({ claudeMd: '', settingsJson: '' });
});

test('writes replace the file in place, keep its mode and leave no temp file behind', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'flux-claude-')), '.claude');
  await mkdir(dir);
  const path = join(dir, 'settings.json');
  await writeFile(path, '{}');
  await chmod(path, 0o640);
  const config = createAgentConfig(dir);
  await config.write({ settingsJson: '{"a":1}', claudeMd: 'md' });
  expect((await stat(path)).mode & 0o777).toBe(0o640);
  expect((await stat(join(dir, 'CLAUDE.md'))).mode & 0o777).toBe(0o600);
  expect((await readdir(dir)).toSorted()).toEqual(['CLAUDE.md', 'settings.json']);
});
