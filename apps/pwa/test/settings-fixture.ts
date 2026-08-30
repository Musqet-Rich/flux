import type { Settings } from '@flux/protocol';

// What a box answers to `settings.get`, for store and component tests.
export const settingsFixture = (overrides: Partial<Settings> = {}): Settings => ({
  flux: {
    reposDir: '/home/flux/repos',
    defaultHarness: 'claude',
    notifyOnAsk: true,
    notifyOnIdle: true,
    notifyOnDone: false,
  },
  env: {
    relayUrl: 'https://relay.example',
    dataDir: '/home/flux/.flux',
    daemonName: 'flux@box',
    pushSubject: 'mailto:ops@example.com',
    claudeCommand: 'claude',
  },
  harnessConfig: { claudeMd: '# Rules\n', settingsJson: '{"model":"opus"}' },
  agents: [],
  ...overrides,
});
