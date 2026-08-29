import { protocolName } from '@flux/protocol';

// Placeholder until the PWA lands (docs/architecture.md, ADR 0004). Kept trivially testable.
export const pwaName = (): string => `flux-pwa:${protocolName()}`;
