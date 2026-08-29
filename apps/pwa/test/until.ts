import { watch } from 'vue';

// Resolves once a reactive condition holds (engineering.md § Testing: await the thing, never
// sleep). Vue's own tracking decides when to re-check, so nothing polls.

export const until = (condition: () => boolean): Promise<void> =>
  new Promise((resolve) => {
    const stop = watch(
      condition,
      (ok) => {
        if (!ok) return;
        resolve();
        queueMicrotask(stop);
      },
      { immediate: true, flush: 'sync' },
    );
  });
