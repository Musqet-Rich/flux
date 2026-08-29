import { fileURLToPath } from 'node:url';

// Where the Flux pi extension lives (ADR 0016), for `--extension`. In development it is the .ts
// source next to this file (pi loads TypeScript through jiti); a build emits it as
// flux-pi-extension.mjs beside index.mjs, and this module is bundled into index.mjs by then.
export const piExtensionPath = (): string => {
  const self = import.meta.url;
  const sibling = self.endsWith('.ts') ? './flux-pi-extension.ts' : './flux-pi-extension.mjs';
  return fileURLToPath(new URL(sibling, self));
};
