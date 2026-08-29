// Neither agent reports its context-window size, so the status bar's `ctx %` needs one from
// somewhere. This is a hand-maintained table keyed by model-id prefix (a `message_start` line
// carries an id like `claude-opus-4-8`, a dated snapshot like `claude-haiku-4-5-20251001`),
// looked up on each model's page under https://platform.claude.com/docs/en/models/ (checked
// 2026-08-29): the Claude 5 family (Fable, Opus, Sonnet), Opus 4.6 to 4.8 and Sonnet 4.6 are 1M;
// Opus 4.5, Sonnet 4.5 and Haiku 4.5 are 200K. Anything older (Opus 4.1, Opus 4, Sonnet 4) has
// left the docs and is not listed, so it reports no window. FLUX_CONTEXT_WINDOW overrides every
// model when that matters, and an unknown model is omitted so the bar shows raw tokens with no
// percentage. Order longest prefix first so the most specific entry wins.

const oneMillion = 1_000_000;
const twoHundredK = 200_000;

const windows: readonly (readonly [string, number])[] = [
  ['claude-haiku-4-5', twoHundredK],
  ['claude-opus-4-5', twoHundredK],
  ['claude-opus-4-6', oneMillion],
  ['claude-opus-4-7', oneMillion],
  ['claude-opus-4-8', oneMillion],
  ['claude-sonnet-4-5', twoHundredK],
  ['claude-sonnet-4-6', oneMillion],
  ['claude-fable-5', oneMillion],
  ['claude-opus-5', oneMillion],
  ['claude-sonnet-5', oneMillion],
];

// `override` is the raw FLUX_CONTEXT_WINDOW string (or undefined); a positive integer there wins
// for every model. Undefined result means "unknown", which the status bar renders as tokens only.
export const contextWindow = (
  model: string,
  override: string | undefined = process.env['FLUX_CONTEXT_WINDOW'],
): number | undefined => {
  if (override !== undefined && override !== '') {
    const parsed = Number(override);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  for (const [prefix, size] of windows) {
    if (model.startsWith(prefix)) return size;
  }
  return undefined;
};
