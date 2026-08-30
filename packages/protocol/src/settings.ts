import type { HarnessKind } from './event-payloads.ts';
import { guards } from './guards.ts';

// What `settings.get` returns and `settings.set` patches (protocol.md § 7). `flux` is the box's
// runtime configuration that may change while the daemon runs; `env` is what only its
// environment sets and is reported read-only; `harnessConfig` is the harness's own global config
// files (ADR 0023 § 1).

export interface FluxSettings {
  reposDir: string;
  defaultHarness: HarnessKind;
  notifyOnAsk: boolean;
  notifyOnIdle: boolean;
  notifyOnDone: boolean;
}

export interface EnvSettings {
  relayUrl: string;
  dataDir: string;
  daemonName: string;
  pushSubject: string;
  claudeCommand: string;
}

// Raw file contents: `~/.claude/CLAUDE.md` and `~/.claude/settings.json` of the flux user.
export interface HarnessConfig {
  claudeMd: string;
  settingsJson: string;
}

export interface Settings {
  flux: FluxSettings;
  env: EnvSettings;
  harnessConfig: HarnessConfig;
}

export interface SettingsPatch {
  flux?: Partial<FluxSettings>;
  harnessConfig?: Partial<HarnessConfig>;
}

const { isString, isBoolean, isRecord, isOneOf, isOptional } = guards;

const isHarnessKind = (v: unknown): v is HarnessKind => isOneOf(v, ['claude', 'pi']);

// A patch may name only fields that exist; a misspelt key would otherwise be silently ignored.
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));

const fluxKeys = ['reposDir', 'defaultHarness', 'notifyOnAsk', 'notifyOnIdle', 'notifyOnDone'];
const harnessConfigKeys = ['claudeMd', 'settingsJson'];

const isFlux = (v: unknown): v is FluxSettings =>
  isRecord(v) &&
  isString(v['reposDir']) &&
  isHarnessKind(v['defaultHarness']) &&
  isBoolean(v['notifyOnAsk']) &&
  isBoolean(v['notifyOnIdle']) &&
  isBoolean(v['notifyOnDone']);

const isFluxPatch = (v: unknown): v is Partial<FluxSettings> =>
  isRecord(v) &&
  onlyKeys(v, fluxKeys) &&
  isOptional(v['reposDir'], isString) &&
  isOptional(v['defaultHarness'], isHarnessKind) &&
  isOptional(v['notifyOnAsk'], isBoolean) &&
  isOptional(v['notifyOnIdle'], isBoolean) &&
  isOptional(v['notifyOnDone'], isBoolean);

const isEnv = (v: unknown): v is EnvSettings =>
  isRecord(v) &&
  isString(v['relayUrl']) &&
  isString(v['dataDir']) &&
  isString(v['daemonName']) &&
  isString(v['pushSubject']) &&
  isString(v['claudeCommand']);

const isHarnessConfig = (v: unknown): v is HarnessConfig =>
  isRecord(v) && isString(v['claudeMd']) && isString(v['settingsJson']);

const isHarnessConfigPatch = (v: unknown): v is Partial<HarnessConfig> =>
  isRecord(v) &&
  onlyKeys(v, harnessConfigKeys) &&
  isOptional(v['claudeMd'], isString) &&
  isOptional(v['settingsJson'], isString);

const is = (v: unknown): v is Settings =>
  isRecord(v) && isFlux(v['flux']) && isEnv(v['env']) && isHarnessConfig(v['harnessConfig']);

const isPatch = (v: unknown): v is SettingsPatch =>
  isRecord(v) &&
  onlyKeys(v, ['flux', 'harnessConfig']) &&
  isOptional(v['flux'], isFluxPatch) &&
  isOptional(v['harnessConfig'], isHarnessConfigPatch);

export const settings: { is: typeof is; isPatch: typeof isPatch } = { is, isPatch };
