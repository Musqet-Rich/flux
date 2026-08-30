import type { ServiceConfig } from './build-service-config.ts';

// The no-init-system fallback (ADR 0022 § 6): a typical devcontainer has neither systemd nor
// launchd, so nothing restarts the daemon after its self-update exit and it stays down. This
// restart-loop wrapper is what makes exit-to-update safe there — run it under nohup or the
// container's own restart policy and the daemon comes back into the new code after each exit.

// A single-quoted shell token: everything inside single quotes is literal, and an embedded single
// quote is closed, escaped and reopened (`'\''`), so no path or value can break the quoting.
const sq = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const wrapperEnv = (env: Record<string, string>): string[] =>
  Object.entries(env).map(([key, value]) => `export ${key}=${sq(value)}`);

export const renderWrapperScript = (config: ServiceConfig): string =>
  `${[
    '#!/bin/sh',
    '# Flux daemon restart-loop supervisor (ADR 0022 § 6). This box has no init system, so this',
    '# script is what restarts the daemon after its self-update exits cleanly. Keep it running:',
    '#   nohup THIS_SCRIPT >> LOG 2>&1 &',
    "# or add it to the container's restart policy.",
    'set -eu',
    ...wrapperEnv(config.env),
    'while true; do',
    // `|| true` so a non-zero exit (a config error, exit 2) still loops rather than killing the
    // wrapper under `set -e`; the sleep bounds a crash-loop of a broken build.
    `  ${sq(config.node)} ${sq(config.entry)} daemon || true`,
    '  sleep 1',
    'done',
  ].join('\n')}\n`;
