import { resolve, sep } from 'node:path';

import { DaemonError } from './daemon-error.ts';

// A path handed in by a device must stay inside the directory it is relative to; returns the
// resolved absolute path or refuses with bad_params.
export const inside = (root: string, path: string): string => {
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new DaemonError('bad_params', `path escapes ${root}`);
  }
  return full;
};
