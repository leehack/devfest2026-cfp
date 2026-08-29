interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttlMs: number;
}

const memoryStore = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const requestGenerations = new Map<string, number>();

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
    for (const key of requestGenerations.keys()) {
      requestGenerations.set(key, (requestGenerations.get(key) ?? 0) + 1);
    }
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
      requestGenerations.set(key, (requestGenerations.get(key) ?? 0) + 1);
    }
  }
}

/**
 * Executes an async fetcher with in-flight deduplication, generation tracking, and memory caching.
 * If fresh data is in cache, returns it immediately.
 * If backgroundRevalidate is requested or forced, fetches in background/foreground and notifies subscribers.
 */
export async function swrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    ttlMs?: number;
    force?: boolean;
    backgroundRevalidate?: boolean;
    onRevalidate?: (data: T) => void;
  } = {},
): Promise<T> {
  const {
    ttlMs = DEFAULT_TTL_MS,
    force = false,
    backgroundRevalidate = false,
    onRevalidate,
  } = options;

  if (force) {
    requestGenerations.set(key, (requestGenerations.get(key) ?? 0) + 1);
    inFlightRequests.delete(key);
    memoryStore.delete(key);
  } else {
    const cached = getCached<T>(key);
    if (cached !== undefined) {
      if (backgroundRevalidate) {
        void runFetcher(key, fetcher, ttlMs, onRevalidate).catch(() => {});
      }
      return cached;
    }
  }

  return runFetcher(key, fetcher, ttlMs, onRevalidate);
}

async function runFetcher<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
  onRevalidate?: (data: T) => void,
): Promise<T> {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined;
  if (existing) {
    if (onRevalidate) {
      const boundGen = requestGenerations.get(key) ?? 0;
      void existing
        .then((res) => {
          if (requestGenerations.get(key) === boundGen) {
            onRevalidate(res);
          }
        })
        .catch(() => {});
    }
    return existing;
  }

  const currentGen = (requestGenerations.get(key) ?? 0) + 1;
  requestGenerations.set(key, currentGen);

  const holder: { promise?: Promise<T> } = {};
  const promise = (async () => {
    try {
      const result = await fetcher();
      if (requestGenerations.get(key) === currentGen) {
        setCached(key, result, ttlMs);
        onRevalidate?.(result);
      }
      return result;
    } finally {
      if (inFlightRequests.get(key) === holder.promise) {
        inFlightRequests.delete(key);
      }
    }
  })();

  holder.promise = promise;
  inFlightRequests.set(key, promise);
  return promise;
}
