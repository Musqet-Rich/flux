// The host facts `flux service install` needs, resolved once from the process (its node binary,
// the installed `index.mjs`, the invoking user, the daemon's `FLUX_*` environment) and passed to
// the pure manifest renderers. Detection is injected — `platform`, `isRoot`, `user`, `home`, and
// whether an init system is present (`hasSystemd`) — so all three host branches and root vs
// non-root are exercised in tests without running on three OSes (ADR 0022 § 6).

export type ServiceHost = 'systemd' | 'launchd' | 'wrapper';

export interface ServiceInput {
  platform: NodeJS.Platform;
  hasSystemd: boolean;
  isRoot: boolean;
  // Whether the running process is an installed bundle (`detectDistDir` non-null): a daemon
  // launched from a source checkout (`node src/index.ts`) has no runnable `index.mjs` to bake into
  // a unit and cannot self-update (ADR 0022 § 3), so `service install` refuses it rather than write
  // a supervisor that would run a path plain `node` cannot execute.
  installed: boolean;
  user: string;
  home: string;
  // The absolute node binary and the installed `index.mjs`, baked into the manifest so the
  // supervisor launches this exact build (ADR 0022 § 6).
  node: string;
  entry: string;
  dataDir: string;
  // The full process environment; every `FLUX_*` value and `PATH` is carried into the unit so the
  // supervised daemon sees the same configuration and resolves `claude`/`gh`/`git`.
  env: NodeJS.ProcessEnv;
}

export interface ServiceConfig {
  host: ServiceHost;
  isRoot: boolean;
  user: string;
  home: string;
  node: string;
  entry: string;
  dataDir: string;
  env: Record<string, string>;
}

const detectHost = (platform: NodeJS.Platform, hasSystemd: boolean): ServiceHost => {
  if (platform === 'darwin') return 'launchd';
  if (platform === 'linux' && hasSystemd) return 'systemd';
  return 'wrapper';
};

// Only `PATH` and the `FLUX_*` keys are baked in — the daemon reads nothing else from the
// environment (index.ts header) — and they are sorted so a given install always renders the same
// bytes, which keeps the generated manifest diffable and the tests exact.
const bakedEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const baked: Record<string, string> = {};
  for (const key of Object.keys(env).toSorted()) {
    const value = env[key];
    if (value === undefined) continue;
    if (key === 'PATH' || key.startsWith('FLUX_')) baked[key] = value;
  }
  return baked;
};

export const buildServiceConfig = (input: ServiceInput): ServiceConfig => ({
  host: detectHost(input.platform, input.hasSystemd),
  isRoot: input.isRoot,
  user: input.user,
  home: input.home,
  node: input.node,
  entry: input.entry,
  dataDir: input.dataDir,
  env: bakedEnv(input.env),
});
