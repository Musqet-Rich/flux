import { DaemonError } from '../daemon-error.ts';
import type { ServiceIo } from './service-io.ts';

// Run a supervisor command that must succeed (an install/uninstall step); a non-zero exit becomes
// a DaemonError carrying what the command said — stderr, then stdout, then the exit code — so the
// CLI reports it and exits non-zero.
export const runOrThrow = async (io: ServiceIo, argv: readonly string[]): Promise<void> => {
  const result = await io.run(argv);
  if (result.code === 0) return;
  const said = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
  throw new DaemonError('internal', `${argv.join(' ')}: ${said}`);
};
