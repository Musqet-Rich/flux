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
const agents = [
  { name: 'reviewer', harness: 'claude', model: 'opus', effort: 'high', role: 'be terse' },
];

test.each([
  [{ flux, env, harnessConfig, agents }, true],
  [{ flux, env, harnessConfig, agents: [] }, true],
  [{ flux, env, harnessConfig, agents: [{ name: 'bare' }] }, true],
  [{ flux: { ...flux, defaultHarness: 'pi' }, env, harnessConfig, agents }, true],
  [{ flux: { ...flux, defaultHarness: 'gpt' }, env, harnessConfig, agents }, false],
  [{ flux: { ...flux, notifyOnDone: 'no' }, env, harnessConfig, agents }, false],
  [{ flux: { ...flux, reposDir: 1 }, env, harnessConfig, agents }, false],
  [{ flux, env: { ...env, claudeCommand: undefined }, harnessConfig, agents }, false],
  [{ flux, env, harnessConfig: { claudeMd: '' }, agents }, false],
  [{ flux, env, harnessConfig }, false],
  [{ flux, env, harnessConfig, agents: [{ name: '' }] }, false],
  [{ flux, env, harnessConfig, agents: [{ name: 'a' }, { name: 'a' }] }, false],
  [{ flux, env, harnessConfig, agents: {} }, false],
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
  [{ agents: [] }, true],
  [{ agents: [{ name: 'a' }, { name: 'b', harness: 'pi', role: 'r' }] }, true],
  [{ flux: { defaultHarness: 'gpt' } }, false],
  [{ flux: { reposDir: null } }, false],
  [{ flux: { notifyOnAsk: 1 } }, false],
  [{ flux: { notifyOnIdle: 'yes' } }, false],
  [{ flux: { notifyOnDone: 0 } }, false],
  [{ flux: 'all' }, false],
  [{ harnessConfig: { claudeMd: 1 } }, false],
  [{ harnessConfig: { settingsJson: {} } }, false],
  [{ harnessConfig: [] }, false],
  [{ agents: [{ name: 'a' }, { name: 'a' }] }, false],
  [{ agents: [{ name: 42 }] }, false],
  [{ agents: [{ name: 'a', harness: 'gpt' }] }, false],
  [{ agents: [{ name: 'a', model: '' }] }, false],
  [{ agents: [{ name: 'a', effort: '' }] }, false],
  [{ agents: [{ name: 'a', role: '' }] }, false],
  [{ agents: [{ name: 'a', extra: 1 }] }, false],
  [{ agents: {} }, false],
  [[], false],
  [{ env: {} }, false],
  [{ flux: { reposDir: '/r', repoDir: '/x' } }, false],
  [{ harnessConfig: { claudeMd: '', extra: 1 } }, false],
])('settings.isPatch(%j) is %s', (value, expected) => {
  expect(settings.isPatch(value)).toBe(expected);
});
