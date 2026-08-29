import type { AgentKind } from './event-payloads.ts';
import { guards } from './guards.ts';

// What `settings.get` returns and `settings.set` patches (protocol.md § 7). `flux` is the box's
// runtime configuration that may change while the daemon runs; `env` is what only its
// environment sets and is reported read-only; `agent` is the agent's own global config files.

export interface FluxSettings {
  reposDir: string;
  defaultAgent: AgentKind;
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
export interface AgentConfig {
  claudeMd: string;
  settingsJson: string;
}

export interface Settings {
  flux: FluxSettings;
  env: EnvSettings;
  agent: AgentConfig;
}

export interface SettingsPatch {
  flux?: Partial<FluxSettings>;
  agent?: Partial<AgentConfig>;
}

const { isString, isBoolean, isRecord, isOneOf, isOptional } = guards;

const isAgentKind = (v: unknown): v is AgentKind => isOneOf(v, ['claude', 'pi']);

// A patch may name only fields that exist; a misspelt key would otherwise be silently ignored.
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));

const fluxKeys = ['reposDir', 'defaultAgent', 'notifyOnAsk', 'notifyOnIdle', 'notifyOnDone'];
const agentKeys = ['claudeMd', 'settingsJson'];

const isFlux = (v: unknown): v is FluxSettings =>
  isRecord(v) &&
  isString(v['reposDir']) &&
  isAgentKind(v['defaultAgent']) &&
  isBoolean(v['notifyOnAsk']) &&
  isBoolean(v['notifyOnIdle']) &&
  isBoolean(v['notifyOnDone']);

const isFluxPatch = (v: unknown): v is Partial<FluxSettings> =>
  isRecord(v) &&
  onlyKeys(v, fluxKeys) &&
  isOptional(v['reposDir'], isString) &&
  isOptional(v['defaultAgent'], isAgentKind) &&
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

const isAgent = (v: unknown): v is AgentConfig =>
  isRecord(v) && isString(v['claudeMd']) && isString(v['settingsJson']);

const isAgentPatch = (v: unknown): v is Partial<AgentConfig> =>
  isRecord(v) &&
  onlyKeys(v, agentKeys) &&
  isOptional(v['claudeMd'], isString) &&
  isOptional(v['settingsJson'], isString);

const is = (v: unknown): v is Settings =>
  isRecord(v) && isFlux(v['flux']) && isEnv(v['env']) && isAgent(v['agent']);

const isPatch = (v: unknown): v is SettingsPatch =>
  isRecord(v) &&
  onlyKeys(v, ['flux', 'agent']) &&
  isOptional(v['flux'], isFluxPatch) &&
  isOptional(v['agent'], isAgentPatch);

export const settings: { is: typeof is; isPatch: typeof isPatch } = { is, isPatch };
