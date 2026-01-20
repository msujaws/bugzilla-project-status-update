type MemoryEntry<T> = { exp: number; value: T };

export type ExpiringMemoryCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  /** Returns the number of entries in the cache (for observability/testing) */
  size(): number;
};

export const DAY_IN_SECONDS = 24 * 60 * 60;
export const DAY_IN_MILLISECONDS = DAY_IN_SECONDS * 1000;

// Clean up expired entries periodically to prevent memory growth
const CLEANUP_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function createExpiringMemoryCache<T>(
  ttlMs: number,
): ExpiringMemoryCache<T> {
  const store = new Map<string, MemoryEntry<T>>();
  let lastCleanup = Date.now();
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

  function cleanupExpired() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.exp) {
        store.delete(key);
      }
    }
    lastCleanup = now;
  }

  function maybeCleanup() {
    const now = Date.now();
    if (now - lastCleanup >= CLEANUP_INTERVAL_MS) {
      cleanupExpired();
    }
  }

  // Start periodic cleanup timer
  cleanupTimer = setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
  // Allow process to exit even if timer is running
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

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
      maybeCleanup();
      store.set(key, { exp: Date.now() + ttlMs, value });
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}

type GlobalWithCaches = typeof globalThis & { caches?: CacheStorage };

export const getDefaultCache = (): Cache | undefined =>
  (globalThis as GlobalWithCaches).caches?.default;
