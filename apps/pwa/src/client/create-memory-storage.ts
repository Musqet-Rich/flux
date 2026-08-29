// Key–value persistence for the device: the pairing record and cached logs. IndexedDB in the
// browser, memory in tests; both are tiny because the shapes are validated by their guards on
// the way out, not trusted on the way in.

export interface Storage {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  // Forgets every key starting with `prefix`.
  clear: (prefix: string) => Promise<void>;
}

export const createMemoryStorage = (): Storage => {
  const map = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(map.get(key)),
    set: (key, value) => {
      map.set(key, structuredClone(value));
      return Promise.resolve();
    },
    remove: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
    clear: (prefix) => {
      for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
      return Promise.resolve();
    },
  };
};
