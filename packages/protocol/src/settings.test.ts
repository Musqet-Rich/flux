import { expect, test } from 'vitest';

import { settings } from './settings.ts';

const flux = {
  reposDir: '/home/flux/repos',
  defaultAgent: 'claude',
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
const agent = { claudeMd: '# rules', settingsJson: '{}' };

test.each([
  [{ flux, env, agent }, true],
  [{ flux: { ...flux, defaultAgent: 'pi' }, env, agent }, true],
  [{ flux: { ...flux, defaultAgent: 'gpt' }, env, agent }, false],
  [{ flux: { ...flux, notifyOnDone: 'no' }, env, agent }, false],
  [{ flux: { ...flux, reposDir: 1 }, env, agent }, false],
  [{ flux, env: { ...env, claudeCommand: undefined }, agent }, false],
  [{ flux, env, agent: { claudeMd: '' } }, false],
  [{ flux, env }, false],
  [{ env, agent }, false],
  [{ flux, agent }, false],
  [null, false],
])('settings.is(%j) is %s', (value, expected) => {
  expect(settings.is(value)).toBe(expected);
});

test.each([
  [{}, true],
  [{ flux: {} }, true],
  [{ flux: { reposDir: '/r' } }, true],
  [{ flux: { defaultAgent: 'pi', notifyOnAsk: false } }, true],
  [{ agent: { settingsJson: '{"a":1}' } }, true],
  [{ agent: { claudeMd: 'x' }, flux: { notifyOnIdle: true, notifyOnDone: true } }, true],
  [{ flux: { defaultAgent: 'gpt' } }, false],
  [{ flux: { reposDir: null } }, false],
  [{ flux: { notifyOnAsk: 1 } }, false],
  [{ flux: { notifyOnIdle: 'yes' } }, false],
  [{ flux: { notifyOnDone: 0 } }, false],
  [{ flux: 'all' }, false],
  [{ agent: { claudeMd: 1 } }, false],
  [{ agent: { settingsJson: {} } }, false],
  [{ agent: [] }, false],
  [[], false],
])('settings.isPatch(%j) is %s', (value, expected) => {
  expect(settings.isPatch(value)).toBe(expected);
});
