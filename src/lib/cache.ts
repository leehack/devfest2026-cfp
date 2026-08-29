interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttlMs: number;
}

const memoryStore = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 3 * 60 * 1000; // 3 minutes

export function getCached<T>(key: string): T | undefined {
  const entry = memoryStore.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > entry.ttlMs) {
    memoryStore.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function setCached<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  memoryStore.set(key, {
    data,
    cachedAt: Date.now(),
    ttlMs,
  });
}

export function invalidateCache(keyOrPrefix?: string): void {
  if (!keyOrPrefix) {
    memoryStore.clear();
    inFlightRequests.clear();
    return;
  }
  for (const key of memoryStore.keys()) {
    if (key === keyOrPrefix || key.startsWith(`${keyOrPrefix}:`) || key.startsWith(keyOrPrefix)) {
      memoryStore.delete(key);
    }
  }
  for (const key of inFlightRequests.keys()) {
    if (key === keyOrPrefix || key.startsWith(`${keyOrPrefix}:`) || key.startsWith(keyOrPrefix)) {
      inFlightRequests.delete(key);
    }
  }
}

/**
 * Executes an async fetcher with in-flight deduplication and memory caching.
 * If fresh data is in cache, returns it immediately.
 * If stale data exists or force is requested, fetches in background / foreground.
 */
export async function swrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    ttlMs?: number;
    force?: boolean;
    backgroundRevalidate?: boolean;
  } = {},
): Promise<T> {
  const { ttlMs = DEFAULT_TTL_MS, force = false, backgroundRevalidate = false } = options;

  if (force) {
    // Purge any pre-mutation in-flight requests for this key
    inFlightRequests.delete(key);
    memoryStore.delete(key);
  } else {
    const cached = getCached<T>(key);
    if (cached !== undefined) {
      if (backgroundRevalidate) {
        // Trigger background refresh without blocking
        void runFetcher(key, fetcher, ttlMs).catch(() => {});
      }
      return cached;
    }
  }

  return runFetcher(key, fetcher, ttlMs);
}

async function runFetcher<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      const result = await fetcher();
      setCached(key, result, ttlMs);
      return result;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, promise);
  return promise;
}
