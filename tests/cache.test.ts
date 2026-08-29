import { describe, expect, it } from 'vitest';
import { getCached, invalidateCache, setCached, swrFetch } from '../src/lib/cache';
import { prefetchByPath } from '../src/lib/prefetch';

describe('cache', () => {
  it('stores and retrieves cached values within TTL', () => {
    invalidateCache();
    setCached('test:key', { foo: 'bar' }, 1000);
    expect(getCached('test:key')).toEqual({ foo: 'bar' });
  });

  it('expires entries after TTL', () => {
    invalidateCache();
    setCached('test:expired', { foo: 'bar' }, -10);
    expect(getCached('test:expired')).toBeUndefined();
  });

  it('invalidates by exact key or prefix', () => {
    invalidateCache();
    setCached('cfpWindow:cfp1', { id: 'cfp1' });
    setCached('cfpWindow:cfp2', { id: 'cfp2' });
    setCached('committee:cfp1', { count: 3 });

    invalidateCache('cfpWindow:cfp1');
    expect(getCached('cfpWindow:cfp1')).toBeUndefined();
    expect(getCached('cfpWindow:cfp2')).toBeDefined();
    expect(getCached('committee:cfp1')).toBeDefined();

    invalidateCache('cfpWindow');
    expect(getCached('cfpWindow:cfp2')).toBeUndefined();
    expect(getCached('committee:cfp1')).toBeDefined();
  });

  it('deduplicates in-flight fetchers', async () => {
    invalidateCache();
    let callCount = 0;
    const fetcher = async () => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { result: 'ok' };
    };

    const [res1, res2] = await Promise.all([
      swrFetch('test:dedupe', fetcher),
      swrFetch('test:dedupe', fetcher),
    ]);

    expect(res1).toEqual({ result: 'ok' });
    expect(res2).toEqual({ result: 'ok' });
    expect(callCount).toBe(1);
  });

  it('returns cached data immediately on subsequent calls', async () => {
    invalidateCache();
    let callCount = 0;
    const fetcher = async () => {
      callCount += 1;
      return { count: callCount };
    };

    const first = await swrFetch('test:cached', fetcher);
    expect(first).toEqual({ count: 1 });

    const second = await swrFetch('test:cached', fetcher);
    expect(second).toEqual({ count: 1 });
    expect(callCount).toBe(1);

    const forced = await swrFetch('test:cached', fetcher, { force: true });
    expect(forced).toEqual({ count: 2 });
    expect(callCount).toBe(2);
  });

  it('purges pre-existing in-flight requests on force refresh', async () => {
    invalidateCache();
    const slowPreWriteFetcher = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { val: 'stale-pre-write' };
    };

    // Start pre-write fetch
    void swrFetch('test:stale', slowPreWriteFetcher);

    // Force post-write fetch
    const postWriteFetcher = async () => ({ val: 'fresh-post-write' });
    const freshResult = await swrFetch('test:stale', postWriteFetcher, { force: true });

    expect(freshResult).toEqual({ val: 'fresh-post-write' });
    expect(getCached('test:stale')).toEqual({ val: 'fresh-post-write' });
  });

  it('prevents superseded slow background fetch from overwriting newer forced fetch result', async () => {
    invalidateCache();
    const slowPreWriteFetcher = async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { val: 'stale-pre-write' };
    };

    // Start background fetch
    void swrFetch('test:generation', slowPreWriteFetcher);

    // Later, forced mutation refresh finishes quickly
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fastPostWriteFetcher = async () => ({ val: 'fresh-post-write' });
    const fresh = await swrFetch('test:generation', fastPostWriteFetcher, { force: true });
    expect(fresh).toEqual({ val: 'fresh-post-write' });
    expect(getCached('test:generation')).toEqual({ val: 'fresh-post-write' });

    // Wait for the slow pre-write fetcher to finish
    await new Promise((resolve) => setTimeout(resolve, 70));

    // Stale fetcher must NOT overwrite the cache
    expect(getCached('test:generation')).toEqual({ val: 'fresh-post-write' });
  });

  it('notifies onRevalidate callback when background revalidation finishes', async () => {
    invalidateCache();
    setCached('test:reval', { count: 1 });

    let revalidatedData: { count: number } | null = null;
    const fetcher = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { count: 2 };
    };

    const initial = await swrFetch('test:reval', fetcher, {
      backgroundRevalidate: true,
      onRevalidate: (data) => {
        revalidatedData = data;
      },
    });

    expect(initial).toEqual({ count: 1 });
    expect(revalidatedData).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(revalidatedData).toEqual({ count: 2 });
    expect(getCached('test:reval')).toEqual({ count: 2 });
  });
});

describe('prefetch', () => {
  it('executes prefetch without crashing', () => {
    expect(() => {
      prefetchByPath('/c/devfest-2026/admin/committee');
      prefetchByPath('/c/devfest-2026/review');
      prefetchByPath('/c/devfest-2026/submit');
      prefetchByPath('/me');
      prefetchByPath('/');
    }).not.toThrow();
  });
});
