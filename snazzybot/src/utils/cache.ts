type MemoryEntry<T> = { exp: number; value: T };

export type ExpiringMemoryCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
};

export const DAY_IN_SECONDS = 24 * 60 * 60;
export const DAY_IN_MILLISECONDS = DAY_IN_SECONDS * 1000;

export function createExpiringMemoryCache<T>(
  ttlMs: number,
): ExpiringMemoryCache<T> {
  const store = new Map<string, MemoryEntry<T>>();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return;
      if (entry.exp <= Date.now()) {
        store.delete(key);
        return;
      }
      return entry.value;
    },
    set(key, value) {
      store.set(key, { exp: Date.now() + ttlMs, value });
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

type GlobalWithCaches = typeof globalThis & { caches?: CacheStorage };

export const getDefaultCache = (): Cache | undefined =>
  (globalThis as GlobalWithCaches).caches?.default;
