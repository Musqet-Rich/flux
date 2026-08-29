import { protocolVersion } from '@flux/protocol';

// Placeholder until the relay lands (docs/architecture.md, ADR 0011). Kept trivially testable.
export const relayName = (): string => `flux-relay:v${protocolVersion}`;
