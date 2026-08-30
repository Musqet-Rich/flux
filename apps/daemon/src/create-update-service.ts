import type { Ephemeral } from '@flux/protocol';

import type { HostTransport } from './connect-relay.ts';
import type { UpdateService } from './handler-context.ts';
import { applyUpdate } from './update/apply-update.ts';
import { version } from './version.ts';

// Builds the self-update service the `daemon.update` handler drives (ADR 0022). `transport` and
// `stop` are getters because both are created after this in the composition root; `apply` closes
// over them and only runs when an RPC arrives, by which point they exist. A dev build (null
// distDir) is refused in the handler and guarded again here, so nothing installs over a source
// checkout. The real fetch and process exit are wired here so `apply-update` stays testable.

export interface UpdateServiceConfig {
  distDir?: string | null;
  releaseRepo?: string;
}

export const createUpdateService = (
  config: UpdateServiceConfig,
  transport: () => HostTransport,
  stop: () => Promise<void>,
): UpdateService => {
  const distDir = config.distDir ?? null;
  const apply = (target: string): void => {
    if (distDir === null) return;
    void applyUpdate({
      target,
      fetch: (url) => globalThis.fetch(url),
      emit: (data: Ephemeral) => void transport().broadcast({ kind: 'ephemeral', data }),
      stop,
      exit: (code) => process.exit(code),
      distDir,
      ...(config.releaseRepo === undefined ? {} : { repo: config.releaseRepo }),
    });
  };
  return { currentVersion: version, distDir, apply };
};
