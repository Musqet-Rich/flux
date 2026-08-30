import type { ServiceInput } from './build-service-config.ts';
import { realServiceIo } from './real-service-io.ts';
import { runService } from './run-service.ts';

// The composition-root entrypoint index.ts calls: the `flux service` dispatch wired to the real
// filesystem and `systemctl`/`launchctl` effects. A thin default-io wrapper over `runService` (the
// injectable core, exercised in tests with fakes), kept in its own file so index.ts imports one
// module for the whole subcommand and stays inside its per-file dependency budget.
export const runServiceCli = (sub: string | undefined, input: ServiceInput): Promise<string[]> =>
  runService(sub, { io: realServiceIo, input });
