/** Tiny promise wrapper around one IndexedDB object store (no dependency). */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

const DB_NAME = "sandroid-session-cache";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export const idbStore: KeyValueStore = {
  get: <T,>(key: string) => tx<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key, value) => tx("readwrite", (s) => s.put(value, key)).then(() => undefined),
  del: (key) => tx("readwrite", (s) => s.delete(key)).then(() => undefined),
};

/** In-memory fallback (tests, private mode without IndexedDB). */
export function memoryStore(): KeyValueStore {
  const m = new Map<string, unknown>();
  return {
    get: async <T,>(key: string) => m.get(key) as T | undefined,
    set: async (key, value) => void m.set(key, structuredClone(value)),
    del: async (key) => void m.delete(key),
  };
}
