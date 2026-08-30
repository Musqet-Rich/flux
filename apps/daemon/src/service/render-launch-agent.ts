import type { ServiceConfig } from './build-service-config.ts';
import { servicePaths } from './service-paths.ts';

// The macOS LaunchAgent (ADR 0022 § 6). A per-user agent, not a system daemon, so it needs no
// sudo and runs as the logged-in user: the coding agents then inherit that user's keychain, PATH
// and `claude`/`gh` logins. `RunAtLoad` and `KeepAlive` make it always-on and restart it after
// the self-update exit. launchd offers almost none of systemd's confinement, so this is "runs as
// you, lightly sandboxed" — acceptable because the agents sandbox themselves. A headless Mac that
// must run before any login needs a root LaunchDaemon instead, at the cost of the user's GUI
// session and keychain; that caveat is documented in docs/releases.md, not automated here.

// launchd manifests are XML plists, so `&`, `<` and `>` in a path or env value are escaped.
const xml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const plistEnv = (env: Record<string, string>): string[] =>
  Object.entries(env).flatMap(([key, value]) => [
    `    <key>${xml(key)}</key>`,
    `    <string>${xml(value)}</string>`,
  ]);

export const renderLaunchAgent = (config: ServiceConfig): string =>
  `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>com.flux.daemon</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${xml(config.node)}</string>`,
    `    <string>${xml(config.entry)}</string>`,
    '    <string>daemon</string>',
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...plistEnv(config.env),
    '  </dict>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xml(config.home)}</string>`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${xml(servicePaths(config).log)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(servicePaths(config).log)}</string>`,
    '</dict>',
    '</plist>',
  ].join('\n')}\n`;
