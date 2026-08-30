import { expect, test } from 'vitest';

import type { ServiceConfig } from './build-service-config.ts';
import { renderLaunchAgent } from './render-launch-agent.ts';

const config: ServiceConfig = {
  host: 'launchd',
  isRoot: false,
  user: 'rich',
  home: '/Users/rich',
  node: '/opt/homebrew/bin/node',
  entry: '/Users/rich/flux/apps/daemon/dist/index.mjs',
  dataDir: '/Users/rich/.flux',
  env: { FLUX_RELAY_URL: 'https://flux.example.com', PATH: '/usr/bin' },
};

test('renders a per-user LaunchAgent that runs at load and stays alive', () => {
  const plist = renderLaunchAgent(config);
  expect(plist).toContain('<key>Label</key>');
  expect(plist).toContain('<string>com.flux.daemon</string>');
  expect(plist).toContain('<string>/opt/homebrew/bin/node</string>');
  expect(plist).toContain('<string>/Users/rich/flux/apps/daemon/dist/index.mjs</string>');
  expect(plist).toContain('<string>daemon</string>');
  expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
  expect(plist).toContain('<key>KeepAlive</key>\n  <true/>');
  expect(plist).toContain(
    '<key>FLUX_RELAY_URL</key>\n    <string>https://flux.example.com</string>',
  );
  expect(plist).toContain('<string>/Users/rich/.flux/flux-daemon.log</string>');
  expect(plist).toContain('<key>WorkingDirectory</key>\n  <string>/Users/rich</string>');
  expect(plist.endsWith('</plist>\n')).toBe(true);
});

test('escapes XML metacharacters in values', () => {
  const plist = renderLaunchAgent({ ...config, env: { FLUX_X: 'a&b<c>d' } });
  expect(plist).toContain('<string>a&amp;b&lt;c&gt;d</string>');
});
