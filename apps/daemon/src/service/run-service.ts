import { DaemonError } from '../daemon-error.ts';
import type { ServiceInput } from './build-service-config.ts';
import { buildServiceConfig } from './build-service-config.ts';
import { installService } from './install-service.ts';
import type { ServiceIo } from './service-io.ts';
import { serviceStatus } from './service-status.ts';
import { uninstallService } from './uninstall-service.ts';

// The `flux service <sub>` entrypoint: resolve the host from the injected input, then dispatch to
// install, uninstall or status and return the lines to print. An unknown subcommand is a
// `bad_params` DaemonError, which index.ts reports and exits non-zero on, like `flux pair`.

export interface ServiceDeps {
  io: ServiceIo;
  input: ServiceInput;
}

export const runService = (sub: string | undefined, deps: ServiceDeps): Promise<string[]> => {
  const config = buildServiceConfig(deps.input);
  if (sub === 'install') {
    // Baking a source-checkout path into a supervisor unit would write an `ExecStart`/plist that
    // plain `node` cannot run, and such a daemon cannot self-update anyway (ADR 0022 § 3). Refuse
    // it here, consistent with self-update's own dev-checkout refusal.
    if (!deps.input.installed) {
      return Promise.reject(
        new DaemonError(
          'unsupported',
          'flux service install needs an installed daemon bundle; this looks like a source ' +
            'checkout (run it from the installed index.mjs)',
        ),
      );
    }
    return installService(config, deps.io);
  }
  if (sub === 'uninstall') return uninstallService(config, deps.io);
  if (sub === 'status') return serviceStatus(config, deps.io);
  return Promise.reject(
    new DaemonError(
      'bad_params',
      `unknown service command ${sub ?? ''}; use install|uninstall|status`,
    ),
  );
};
