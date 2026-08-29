import { protocolVersion } from '@flux/protocol';

// Placeholder until the daemon lands (docs/architecture.md). Kept trivially testable.
export const daemonName = (): string => `flux-daemon:v${protocolVersion}`;
