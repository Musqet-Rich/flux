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

// An Agent's tool policy (ADR 0023 § 4/§ 5). `all` is today's behaviour (the full toolset, no
// tools flag). `allow`/`deny` carry a non-empty `list` of loose tool names (built-ins like `Bash`,
// `Edit`; suggested, not an enum). `none` removes every non-Flux tool. `list` is omitted for
// `all`/`none`. The Flux tools (`flux_ask`/`flux_notify`) stay available in every mode — the box
// keeps them out of any denylist and they survive `none` (they ride on `--mcp-config`, § 5).
export type ToolsMode = 'all' | 'allow' | 'deny' | 'none';

export interface AgentTools {
  mode: ToolsMode;
  list?: string[];
}

// A saved Agent (ADR 0023 § 2): a named, reusable spec the operator picks at session create.
// `harness` pins the runtime when set (advisory — the create call's harness still wins, § 3);
// `model`/`effort`/`role` are loose free-text the box compiles to harness flags, each omitted
// when unset. `tools` is the Agent's tool policy (§ 4), omitted when unset (== mode `all`).
// `manager` (ADR 0025) opts this Agent into the audited fleet-control tools (list/open/send/
// close/read on OTHER sessions); omitted (never `false`) when off, which is every ordinary Agent.
export interface AgentSpec {
  name: string;
  harness?: HarnessKind;
  model?: string;
  effort?: string;
  role?: string;
  tools?: AgentTools;
  manager?: boolean;
}

export interface Settings {
  flux: FluxSettings;
  env: EnvSettings;
  harnessConfig: HarnessConfig;
  // Saved Agents (ADR 0023 § 2); a `settings.set` patch with `agents` replaces the whole list.
  // Optional on the wire so a daemon built before this shipped, which omits it, still passes the
  // device's result guard; the box that has it always sends it, absent reads as no saved Agents.
  agents?: AgentSpec[];
}

export interface SettingsPatch {
  flux?: Partial<FluxSettings>;
  harnessConfig?: Partial<HarnessConfig>;
  // Replaces the whole saved-Agents list (patch semantics are per-collection, not per-element).
  agents?: AgentSpec[];
}

const { isString, isBoolean, isRecord, isArrayOf, isOneOf, isOptional } = guards;

const isHarnessKind = (v: unknown): v is HarnessKind => isOneOf(v, ['claude', 'pi']);

// `model`/`effort`/`role` are loose free-text (ADR 0023 § 3): non-empty, not enum membership.
const isFilledString = (v: unknown): v is string => isString(v) && v.length > 0;

// A patch may name only fields that exist; a misspelt key would otherwise be silently ignored.
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));

const fluxKeys = ['reposDir', 'defaultHarness', 'notifyOnAsk', 'notifyOnIdle', 'notifyOnDone'];
const harnessConfigKeys = ['claudeMd', 'settingsJson'];
const agentKeys = ['name', 'harness', 'model', 'effort', 'role', 'tools', 'manager'];
const toolsKeys = ['mode', 'list'];

const isFilledStringList = (v: unknown): v is string[] =>
  isArrayOf(v, isFilledString) && v.length > 0;

// `allow`/`deny` require a non-empty list of non-empty names; `all`/`none` forbid a list, so a
// present-but-unused `list` is a guard failure (→ `bad_params`), not silently dropped.
const isAgentTools = (v: unknown): v is AgentTools =>
  isRecord(v) &&
  onlyKeys(v, toolsKeys) &&
  isOneOf(v['mode'], ['all', 'allow', 'deny', 'none']) &&
  (v['mode'] === 'allow' || v['mode'] === 'deny'
    ? isFilledStringList(v['list'])
    : v['list'] === undefined);

const isAgentSpec = (v: unknown): v is AgentSpec =>
  isRecord(v) &&
  onlyKeys(v, agentKeys) &&
  isFilledString(v['name']) &&
  isOptional(v['harness'], isHarnessKind) &&
  isOptional(v['model'], isFilledString) &&
  isOptional(v['effort'], isFilledString) &&
  isOptional(v['role'], isFilledString) &&
  isOptional(v['tools'], isAgentTools) &&
  isOptional(v['manager'], isBoolean);

// The whole saved-Agents list: every element valid and names unique, so `settings.set` returns
// `bad_params` for a duplicate name rather than silently keeping the last of the pair.
const isAgentList = (v: unknown): v is AgentSpec[] =>
  isArrayOf(v, isAgentSpec) && new Set(v.map((a) => a.name)).size === v.length;

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
  isRecord(v) &&
  isFlux(v['flux']) &&
  isEnv(v['env']) &&
  isHarnessConfig(v['harnessConfig']) &&
  isOptional(v['agents'], isAgentList);

const isPatch = (v: unknown): v is SettingsPatch =>
  isRecord(v) &&
  onlyKeys(v, ['flux', 'harnessConfig', 'agents']) &&
  isOptional(v['flux'], isFluxPatch) &&
  isOptional(v['harnessConfig'], isHarnessConfigPatch) &&
  isOptional(v['agents'], isAgentList);

// `isTools` is exported so the box can re-validate a session's persisted tool policy (stored as
// JSON text) when it reads a row back, the same guard the wire uses.
export const settings: {
  is: typeof is;
  isPatch: typeof isPatch;
  isTools: typeof isAgentTools;
} = { is, isPatch, isTools: isAgentTools };
