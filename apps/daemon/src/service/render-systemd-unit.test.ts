import { expect, test } from 'vitest';

import type { ServiceConfig } from './build-service-config.ts';
import { renderSystemdUnit } from './render-systemd-unit.ts';

const config: ServiceConfig = {
  host: 'systemd',
  isRoot: true,
  user: 'flux',
  home: '/home/flux',
  node: '/usr/bin/node',
  entry: '/home/flux/flux/apps/daemon/dist/index.mjs',
  dataDir: '/home/flux/.flux',
  env: { FLUX_RELAY_URL: 'https://flux.example.com', PATH: '/usr/bin' },
};

test('tailors ExecStart, user and environment to the install and keeps the hardening', () => {
  const unit = renderSystemdUnit(config);
  expect(unit).toContain('User=flux');
  expect(unit).toContain('WorkingDirectory=/home/flux');
  expect(unit).toContain(
    'ExecStart="/usr/bin/node" "/home/flux/flux/apps/daemon/dist/index.mjs" daemon',
  );
  expect(unit).toContain('Environment="FLUX_RELAY_URL=https://flux.example.com"');
  expect(unit).toContain('Environment="PATH=/usr/bin"');
  expect(unit).toContain('Restart=always');
  expect(unit).toContain('RestartSec=5');
  expect(unit).toContain('RestartPreventExitStatus=2 3');
  expect(unit).toContain('KillMode=mixed');
  expect(unit).toContain('TimeoutStopSec=60');
  expect(unit).toContain('NoNewPrivileges=true');
  expect(unit).toContain('SystemCallArchitectures=native');
  expect(unit).toContain('WantedBy=multi-user.target');
  expect(unit.endsWith('\n')).toBe(true);
});

test('escapes backslashes, quotes and percent specifiers in environment values', () => {
  const unit = renderSystemdUnit({ ...config, env: { FLUX_X: 'a"b\\c%d' } });
  expect(unit).toContain('Environment="FLUX_X=a\\"b\\\\c%%d"');
});

test('quotes the node and entry paths so a space cannot split ExecStart', () => {
  const unit = renderSystemdUnit({
    ...config,
    node: '/opt/my node/bin/node',
    entry: '/home/flux/app dir/dist/index.mjs',
  });
  expect(unit).toContain(
    'ExecStart="/opt/my node/bin/node" "/home/flux/app dir/dist/index.mjs" daemon',
  );
});

test('escapes percent and dollar in the ExecStart paths so they are passed verbatim', () => {
  const unit = renderSystemdUnit({ ...config, entry: '/home/flux/a%b$c/index.mjs' });
  expect(unit).toContain('"/home/flux/a%%b$$c/index.mjs" daemon');
});
