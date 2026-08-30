import type { ServiceConfig } from './build-service-config.ts';

// The systemd unit for a Linux box, modelled on `deploy/flux-daemon.service` and tailored to the
// running install: the absolute node binary, the installed `index.mjs`, the invoking user and the
// daemon's baked environment (ADR 0022 § 6). `Restart=always` and `WantedBy=multi-user.target`
// make it always-on and start-on-boot, and — with the daemon's clean `process.exit(0)` after a
// self-update — restart it into the new code. `RestartPreventExitStatus=2 3` keeps a config error
// (2) or a data-dir conflict (3) down instead of crash-looping (ADR 0017). `RestartSec=5` bounds
// the backoff of a signed-but-broken release, which the supervisor would otherwise restart in a
// tight loop (ADR 0022 consequences). The hardening is the same a box running agents can bear:
// no privilege escalation and no kernel or system writes, but the home stays writable and there
// is no system-call filter because Claude Code's sandbox needs mount and user namespaces.

const HARDENING = `NoNewPrivileges=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
PrivateDevices=true
PrivateTmp=true
RemoveIPC=true
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native`;

// systemd reads `Environment="KEY=value"`; a literal backslash or double quote in the value is
// escaped so the quoting cannot be broken out of.
const systemdEnv = (env: Record<string, string>): string[] =>
  Object.entries(env).map(([key, value]) => {
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return `Environment="${key}=${escaped}"`;
  });

export const renderSystemdUnit = (config: ServiceConfig): string =>
  `${[
    '[Unit]',
    'Description=Flux daemon (agent box)',
    'Documentation=https://github.com/Musqet-Rich/flux',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${config.user}`,
    `WorkingDirectory=${config.home}`,
    ...systemdEnv(config.env),
    `ExecStart=${config.node} ${config.entry} daemon`,
    'Restart=always',
    'RestartSec=5',
    'RestartPreventExitStatus=2 3',
    'KillMode=mixed',
    'TimeoutStopSec=60',
    '',
    HARDENING,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n')}\n`;
