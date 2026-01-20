export const DAY_IN_SECONDS = 24 * 60 * 60;
export const DAY_IN_MILLISECONDS = DAY_IN_SECONDS * 1000;

type GlobalWithCaches = typeof globalThis & { caches?: CacheStorage };

export const getDefaultCache = (): Cache | undefined =>
  (globalThis as GlobalWithCaches).caches?.default;
