// The public relay a fresh install connects to when FLUX_RELAY_URL is unset (index.ts), so a
// `curl | sh` install then `flux pair` works with nothing to configure. Override it only to
// self-host. Its own module because it is imported by both the CLI and its pinned-value test.
export const defaultRelayUrl = 'https://fluxagent.me';
