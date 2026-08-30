// The app version stamped into the build by tsdown's `define` (tsdown.config.ts), read from the
// root package.json at build. The fallback keeps source and test runs (vitest, `node src`)
// working, where the define is not applied. One version for all three apps, ADR 0021.
declare const FLUX_VERSION: string;

export const version = typeof FLUX_VERSION === 'string' ? FLUX_VERSION : '0.0.0-dev';
