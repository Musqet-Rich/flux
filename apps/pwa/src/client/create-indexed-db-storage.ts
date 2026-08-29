import type { Storage } from './create-memory-storage.ts';

// The browser's persistence (architecture.md § PWA): one object store, keyed by string. Every
// IDB request is wrapped once, here.

const dbName = 'flux';
const storeName = 'kv';

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.addEventListener('success', () => {
      resolve(req.result);
    });
    req.addEventListener('error', () => {
      reject(req.error ?? new Error('indexeddb'));
    });
  });

const openDb = (): Promise<IDBDatabase> => {
  const req = indexedDB.open(dbName, 1);
  req.addEventListener('upgradeneeded', () => {
    req.result.createObjectStore(storeName);
  });
  return request(req);
};

export const createIndexedDbStorage = (): Storage => {
  const db = openDb();
  const run = async <T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const store = (await db).transaction(storeName, mode).objectStore(storeName);
    return request(op(store));
  };
  return {
    get: (key) => run('readonly', (store) => store.get(key)),
    set: async (key, value) => {
      await run('readwrite', (store) => store.put(value, key));
    },
    remove: async (key) => {
      await run('readwrite', (store) => store.delete(key));
    },
    // Keys are strings, so every key with the prefix sorts between it and prefix + U+FFFF.
    clear: async (prefix) => {
      const range = IDBKeyRange.bound(prefix, `${prefix}\uFFFF`);
      await run('readwrite', (store) => store.delete(range));
    },
  };
};
