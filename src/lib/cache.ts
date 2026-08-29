interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttlMs: number;
}

export function isAuthError(error: unknown): boolean {
  const code = String((error as any)?.code || (error as any)?.message || '');
  return /permission-denied|unauthenticated|unauthorized|forbidden|PERMISSION_DENIED/i.test(code);
}

interface InFlightEntry<T> {
  promise: Promise<T>;
  generation: number;
  superseded: boolean;
  onRevalidates: Array<(data: T) => void>;
  onErrors: Array<(error: unknown) => void>;
}

const memoryStore = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, InFlightEntry<any>>();
const requestGenerations = new Map<string, number>();

const DEFAULT_TTL_MS = 3 * 60 * 1000; // 3 minutes

export function hasCached(key: string): boolean {
  const entry = memoryStore.get(key);
  if (!entry) return false;
  if (Date.now() - entry.cachedAt > entry.ttlMs) {
    memoryStore.delete(key);
    return false;
  }
  return true;
}

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
    for (const entry of inFlightRequests.values()) {
      entry.superseded = true;
    }
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
  for (const [key, entry] of inFlightRequests.entries()) {
    if (key === keyOrPrefix || key.startsWith(`${keyOrPrefix}:`) || key.startsWith(keyOrPrefix)) {
      entry.superseded = true;
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
    onError?: (error: unknown) => void;
  } = {},
): Promise<T> {
  const {
    ttlMs = DEFAULT_TTL_MS,
    force = false,
    backgroundRevalidate = false,
    onRevalidate,
    onError,
  } = options;

  if (force) {
    const entry = inFlightRequests.get(key);
    if (entry) {
      entry.superseded = true;
      inFlightRequests.delete(key);
    }
    requestGenerations.set(key, (requestGenerations.get(key) ?? 0) + 1);
    memoryStore.delete(key);
  } else {
    if (hasCached(key)) {
      const cached = getCached<T>(key) as T;
      if (backgroundRevalidate) {
        void runFetcher(key, fetcher, ttlMs, onRevalidate, onError).catch(() => {});
      }
      return cached;
    }
  }

  return runFetcher(key, fetcher, ttlMs, onRevalidate, onError);
}

async function runFetcher<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
  onRevalidate?: (data: T) => void,
  onError?: (error: unknown) => void,
): Promise<T> {
  const existing = inFlightRequests.get(key) as InFlightEntry<T> | undefined;
  if (existing) {
    if (onRevalidate) existing.onRevalidates.push(onRevalidate);
    if (onError) existing.onErrors.push(onError);
    return existing.promise;
  }

  const currentGen = (requestGenerations.get(key) ?? 0) + 1;
  requestGenerations.set(key, currentGen);

  const entry: InFlightEntry<T> = {
    promise: null as any,
    generation: currentGen,
    superseded: false,
    onRevalidates: [],
    onErrors: [],
  };
  if (onRevalidate) entry.onRevalidates.push(onRevalidate);
  if (onError) entry.onErrors.push(onError);

  const promise = (async () => {
    try {
      const result = await fetcher();
      if (requestGenerations.get(key) === currentGen && !entry.superseded) {
        setCached(key, result, ttlMs);
        for (const cb of entry.onRevalidates) {
          cb(result);
        }
        return result;
      }
      if (hasCached(key)) {
        return getCached<T>(key) as T;
      }
      return await swrFetch(key, fetcher, {
        ttlMs,
        onRevalidate: (fresh) => {
          for (const cb of entry.onRevalidates) {
            cb(fresh);
          }
        },
        onError: (err) => {
          for (const cb of entry.onErrors) {
            cb(err);
          }
        },
      });
    } catch (fetchError) {
      if (requestGenerations.get(key) === currentGen && !entry.superseded) {
        if (isAuthError(fetchError)) {
          invalidateCache(key);
        }
        for (const cb of entry.onErrors) {
          cb(fetchError);
        }
      }
      throw fetchError;
    } finally {
      if (inFlightRequests.get(key) === entry) {
        inFlightRequests.delete(key);
      }
    }
  })();

  entry.promise = promise;
  inFlightRequests.set(key, entry);
  return promise;
}
