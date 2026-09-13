// Free-text model and effort with these as hints (ADR 0023 § 6): the vocabularies move every
// release, so a launch never forces a PWA release. Empty means unset (the box's own default).
// Claude's words; pi and opencode have their own (ADR 0027 § 5), and the box passes whatever is
// typed. Shared by the create form and the session menu's Model & effort sheet (ADR 0032).
export const specHints: { model: readonly string[]; effort: readonly string[] } = {
  model: ['opus', 'sonnet', 'fable'],
  effort: ['low', 'medium', 'high', 'xhigh', 'max'],
};
