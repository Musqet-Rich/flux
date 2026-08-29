// Module shim for SFC imports. vue-tsc types .vue files itself, but oxlint's type-aware
// rules run on tsgolint, which cannot, so without this `import App from './App.vue'` is
// `error`-typed and typescript/no-unsafe-argument fires (docs/scaffold-notes.md § oxlint).
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
