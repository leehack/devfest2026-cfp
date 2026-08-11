import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearFirestore,
  isRetryableFirestoreClearConflict,
} from './e2e/backend';

const lockConflict = () =>
  new Response(
    JSON.stringify({
      error: {
        code: 409,
        status: 'ABORTED',
        message: 'Transaction lock timeout.',
      },
    }),
    { status: 409 },
  );

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Firestore emulator reset', () => {
  it('recognises only the emulator transaction-lock conflict as retryable', () => {
    const body = JSON.stringify({
      error: { status: 'ABORTED', message: 'Transaction lock timeout.' },
    });
    expect(isRetryableFirestoreClearConflict(409, body)).toBe(true);
    expect(isRetryableFirestoreClearConflict(500, body)).toBe(false);
    expect(
      isRetryableFirestoreClearConflict(
        409,
        JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'Lock timeout.' } }),
      ),
    ).toBe(false);
    expect(
      isRetryableFirestoreClearConflict(
        409,
        JSON.stringify({ error: { status: 'ABORTED', message: 'Another conflict.' } }),
      ),
    ).toBe(false);
    expect(isRetryableFirestoreClearConflict(409, 'not json')).toBe(false);
  });

  it('backs off through a transient lock conflict and then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(lockConflict())
      .mockResolvedValueOnce(lockConflict())
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const clearing = clearFirestore();
    await vi.runAllTimersAsync();

    await expect(clearing).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails immediately for any other response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { status: 'ABORTED', message: 'Different conflict.' } }),
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(clearFirestore()).rejects.toThrow('clearFirestore failed: 409');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after the bounded number of transaction-lock retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => lockConflict());
    vi.stubGlobal('fetch', fetchMock);

    const clearing = clearFirestore();
    const assertion = expect(clearing).rejects.toThrow('clearFirestore failed: 409');
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
