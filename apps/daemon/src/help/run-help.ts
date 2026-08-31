import { helpLookup } from './help-lookup.ts';
import { manual } from './manual.ts';

// The `flux help [term]` seam (index.ts): the search term is the CLI arguments joined, empty for the
// overview. Pure bundled text — no relay, no daemon, no socket — so index.ts dispatches it before
// createDaemon, like `flux pair`. Kept as its own function so the CLI path is unit-tested directly.
export const runHelp = (term: string): string =>
  helpLookup(manual, term.trim() === '' ? undefined : term);
