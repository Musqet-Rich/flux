import { expect, test } from 'vitest';

import { settings } from './settings.ts';

const flux = {
  reposDir: '/home/flux/repos',
  defaultHarness: 'claude',
  notifyOnAsk: true,
  notifyOnIdle: true,
  notifyOnDone: false,
};
const env = {
  relayUrl: 'https://flux.example',
  dataDir: '/home/flux/.flux',
  daemonName: 'flux@box',
  pushSubject: 'mailto:ops@example.com',
  claudeCommand: 'claude',
};
const harnessConfig = { claudeMd: '# rules', settingsJson: '{}' };

test.each([
  [{ flux, env, harnessConfig }, true],
  [{ flux: { ...flux, defaultHarness: 'pi' }, env, harnessConfig }, true],
  [{ flux: { ...flux, defaultHarness: 'gpt' }, env, harnessConfig }, false],
  [{ flux: { ...flux, notifyOnDone: 'no' }, env, harnessConfig }, false],
  [{ flux: { ...flux, reposDir: 1 }, env, harnessConfig }, false],
  [{ flux, env: { ...env, claudeCommand: undefined }, harnessConfig }, false],
  [{ flux, env, harnessConfig: { claudeMd: '' } }, false],
  [{ flux, env }, false],
  [{ env, harnessConfig }, false],
  [{ flux, harnessConfig }, false],
  [null, false],
])('settings.is(%j) is %s', (value, expected) => {
  expect(settings.is(value)).toBe(expected);
});

test.each([
  [{}, true],
  [{ flux: {} }, true],
  [{ flux: { reposDir: '/r' } }, true],
  [{ flux: { defaultHarness: 'pi', notifyOnAsk: false } }, true],
  [{ harnessConfig: { settingsJson: '{"a":1}' } }, true],
  [{ harnessConfig: { claudeMd: 'x' }, flux: { notifyOnIdle: true, notifyOnDone: true } }, true],
  [{ flux: { defaultHarness: 'gpt' } }, false],
  [{ flux: { reposDir: null } }, false],
  [{ flux: { notifyOnAsk: 1 } }, false],
  [{ flux: { notifyOnIdle: 'yes' } }, false],
  [{ flux: { notifyOnDone: 0 } }, false],
  [{ flux: 'all' }, false],
  [{ harnessConfig: { claudeMd: 1 } }, false],
  [{ harnessConfig: { settingsJson: {} } }, false],
  [{ harnessConfig: [] }, false],
  [[], false],
  [{ env: {} }, false],
  [{ flux: { reposDir: '/r', repoDir: '/x' } }, false],
  [{ harnessConfig: { claudeMd: '', extra: 1 } }, false],
])('settings.isPatch(%j) is %s', (value, expected) => {
  expect(settings.isPatch(value)).toBe(expected);
});
