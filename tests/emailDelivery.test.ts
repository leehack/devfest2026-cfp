import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMAIL_SENDING_LEASE_MS,
  SEND_QUEUED_EMAIL_TRIGGER_OPTIONS,
  deliver,
  emailClaimMode,
  providerAttemptId,
  resendIdempotencyKey,
  sendViaResend,
  sendingLeaseExpired,
} from '../functions/src/email';

afterEach(() => vi.unstubAllGlobals());

const settings = {
  from: 'DevFest <cfp@example.org>',
  replyTo: 'team@example.org',
  publicUrl: '',
};

const rendered = {
  subject: 'A subject',
  text: 'Plain text',
  html: '<p>Plain text</p>',
};

function successfulFetch() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'provider-email-id' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('email send claims', () => {
  it('starts one queued generation and resumes only the same CloudEvent claim', () => {
    expect(emailClaimMode({ status: 'queued', attempts: 2 }, 'event-a', 2)).toBe('new');
    expect(
      emailClaimMode(
        { status: 'sending', attempts: 3, sendingClaimId: 'event-a' },
        'event-a',
        2,
      ),
    ).toBe('resume');
    expect(
      emailClaimMode(
        { status: 'sending', attempts: 3, sendingClaimId: 'event-a' },
        'event-b',
        2,
      ),
    ).toBeNull();
  });

  it('refuses a stale queued event after a manual retry moved the generation on', () => {
    expect(emailClaimMode({ status: 'queued', attempts: 3 }, 'old-event', 2)).toBeNull();
    expect(emailClaimMode({ status: 'sent', attempts: 3 }, 'old-event', 2)).toBeNull();
  });

  it('expires only a known lease at the recovery boundary', () => {
    const now = 50_000_000;
    const fresh = now - EMAIL_SENDING_LEASE_MS + 1;
    const expired = now - EMAIL_SENDING_LEASE_MS;

    expect(sendingLeaseExpired(fresh, now)).toBe(false);
    expect(sendingLeaseExpired(expired, now)).toBe(true);
    expect(sendingLeaseExpired(new Date(expired), now)).toBe(true);
    expect(sendingLeaseExpired({ toMillis: () => expired }, now)).toBe(true);
    expect(sendingLeaseExpired(undefined, now)).toBe(false);
  });
});

describe('Resend idempotency', () => {
  it('keeps one bounded key for an event retry and changes it for a deliberate resend', () => {
    const first = resendIdempotencyKey('event', 'accepted__proposal', 'cloud-event-a');
    expect(resendIdempotencyKey('event', 'accepted__proposal', 'cloud-event-a')).toBe(first);
    expect(resendIdempotencyKey('event', 'accepted__proposal', 'cloud-event-b')).not.toBe(first);
    expect(resendIdempotencyKey('event', 'rejected__proposal', 'cloud-event-a')).not.toBe(first);
    expect(first.length).toBeLessThan(100);
  });

  it('keeps the provider attempt across an expired claim recovery', () => {
    expect(providerAttemptId({}, 'cloud-event-a')).toBe('cloud-event-a');
    expect(
      providerAttemptId(
        { providerAttemptId: 'cloud-event-a', sendingClaimId: 'old-active-claim' },
        'cloud-event-b',
      ),
    ).toBe('cloud-event-a');
  });

  it('marks a lost provider response as ambiguous so recovery reuses its key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('response timed out')));

    await expect(
      sendViaResend('speaker@example.org', rendered, 'resend-key', settings, 'attempt-key'),
    ).resolves.toMatchObject({ status: 'failed', ambiguous: true });
  });

  it('keeps the attempt identity after a provider-side transient response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'temporary provider failure' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      sendViaResend('speaker@example.org', rendered, 'resend-key', settings, 'attempt-key'),
    ).resolves.toMatchObject({ status: 'failed', ambiguous: true });
  });

  it('configures the Firestore trigger to retry crashes', () => {
    expect(SEND_QUEUED_EMAIL_TRIGGER_OPTIONS).toMatchObject({
      retry: true,
      document: 'cfps/{cfpId}/emailLog/{logId}',
    });
  });

  it('passes the stable attempt key to Resend and omits it for an untracked direct send', async () => {
    const fetchMock = successfulFetch();

    await expect(
      sendViaResend('speaker@example.org', rendered, 'resend-key', settings, 'attempt-key'),
    ).resolves.toMatchObject({ status: 'sent', providerId: 'provider-email-id' });
    await sendViaResend('speaker@example.org', rendered, 'resend-key', settings, 'attempt-key');
    await sendViaResend('speaker@example.org', rendered, 'resend-key', settings);

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'Idempotency-Key': 'attempt-key',
    });
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      'Idempotency-Key': 'attempt-key',
    });
    expect(fetchMock.mock.calls[2][1]?.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('threads the claimed key through rendering to the provider request', async () => {
    const fetchMock = successfulFetch();
    await deliver(
      {
        kind: 'submission_received',
        locale: 'en',
        to: 'speaker@example.org',
        data: { speakerName: 'Ada', title: 'Reliable delivery' },
      },
      'resend-key',
      settings,
      { id: 'event', name: 'DevFest', publicUrl: 'https://cfp.example.org' },
      undefined,
      'claimed-attempt-key',
    );

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'Idempotency-Key': 'claimed-attempt-key',
    });
  });
});
