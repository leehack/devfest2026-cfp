import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMAIL_BATCH,
  batchIdempotencyKey,
  mapBatchResults,
  sendBatchViaResend,
} from '../functions/src/emailBatch';
import { RESEND_RATE_LIMIT_RETRY } from '../functions/src/email';

afterEach(() => vi.unstubAllGlobals());

const emails = [
  { from: 'DevFest <cfp@example.org>', to: ['a@example.org'], subject: 'A', text: 'a', html: '<p>a</p>' },
  { from: 'DevFest <cfp@example.org>', to: ['b@example.org'], subject: 'B', text: 'b', html: '<p>b</p>' },
  { from: 'DevFest <cfp@example.org>', to: ['c@example.org'], subject: 'C', text: 'c', html: '<p>c</p>' },
];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('batch result mapping', () => {
  it('reads a strict response positionally', () => {
    expect(mapBatchResults(2, { data: [{ id: 'x' }, { id: 'y' }] })).toEqual([
      { status: 'sent', providerId: 'x' },
      { status: 'sent', providerId: 'y' },
    ]);
  });

  it('zips permissive errors back into payload order', () => {
    expect(
      mapBatchResults(3, {
        data: [{ id: 'first' }, { id: 'third' }],
        errors: [{ index: 1, message: 'Invalid `to` field' }],
      }),
    ).toEqual([
      { status: 'sent', providerId: 'first' },
      { status: 'failed', error: 'Invalid `to` field' },
      { status: 'sent', providerId: 'third' },
    ]);
  });

  it('refuses a response whose counts do not add up', () => {
    expect(mapBatchResults(3, { data: [{ id: 'only' }] })).toBeNull();
    expect(mapBatchResults(1, { data: [{ id: 'a' }, { id: 'b' }] })).toBeNull();
    expect(mapBatchResults(1, { data: [{}] })).toBeNull();
    expect(mapBatchResults(1, { data: [], errors: [{ message: 'no index' }] })).toBeNull();
    expect(mapBatchResults(1, {})).toBeNull();
    expect(mapBatchResults(1, null)).toBeNull();
  });

  it('keeps one key per manifest', () => {
    const key = batchIdempotencyKey('event', 'batch-1');
    expect(batchIdempotencyKey('event', 'batch-1')).toBe(key);
    expect(batchIdempotencyKey('event', 'batch-2')).not.toBe(key);
    expect(batchIdempotencyKey('other', 'batch-1')).not.toBe(key);
    expect(key.length).toBeLessThan(100);
  });

  it('stays under the provider limit', () => {
    expect(EMAIL_BATCH.maxMembers).toBeLessThanOrEqual(100);
  });
});

describe('batch provider request', () => {
  it('sends one permissive request under the manifest key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], errors: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendBatchViaResend(emails, 'resend-key', 'batch-key')).resolves.toEqual({
      ok: true,
      outcomes: [
        { status: 'sent', providerId: 'a' },
        { status: 'sent', providerId: 'b' },
        { status: 'sent', providerId: 'c' },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails/batch');
    expect(init.headers).toMatchObject({
      'Idempotency-Key': 'batch-key',
      'x-batch-validation': 'permissive',
    });
    expect(JSON.parse(String(init.body))).toEqual(emails);
  });

  it('retries a rate limit with the same key and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(429, { message: 'Too many requests' }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(json(200, { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await sendBatchViaResend(emails, 'resend-key', 'batch-key', { wait });
    expect(result.ok).toBe(true);
    expect(wait).toHaveBeenCalledWith(1_000);
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ 'Idempotency-Key': 'batch-key' });
  });

  it('reports a persistent rate limit, a provider outage and a lost response as ambiguous', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(429, { message: 'slow down' })));
    await expect(
      sendBatchViaResend(emails, 'resend-key', 'batch-key', { wait }),
    ).resolves.toEqual({ ok: false, error: '429: slow down', ambiguous: true });
    expect(wait).toHaveBeenCalledTimes(RESEND_RATE_LIMIT_RETRY.attempts - 1);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(503, { message: 'down' })));
    await expect(sendBatchViaResend(emails, 'resend-key', 'batch-key')).resolves.toMatchObject({
      ok: false,
      ambiguous: true,
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));
    await expect(sendBatchViaResend(emails, 'resend-key', 'batch-key')).resolves.toMatchObject({
      ok: false,
      ambiguous: true,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { data: [{ id: 'only-one' }] })));
    await expect(sendBatchViaResend(emails, 'resend-key', 'batch-key')).resolves.toEqual({
      ok: false,
      error: 'unreadable batch response',
      ambiguous: true,
    });
  });

  it('reports a rejected request as final', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { message: 'API key is invalid' })));
    await expect(sendBatchViaResend(emails, 'resend-key', 'batch-key')).resolves.toEqual({
      ok: false,
      error: '401: API key is invalid',
      ambiguous: false,
    });
  });
});
