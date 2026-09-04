import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMAIL_SENDING_LEASE_MS,
  RESEND_RATE_LIMIT_RETRY,
  SEND_QUEUED_EMAIL_TRIGGER_OPTIONS,
  decisionEmailStillTrue,
  deliver,
  emailClaimMode,
  logId,
  providerAttemptId,
  rateLimitWaitMs,
  resendIdempotencyKey,
  reviewedRecipientStillTrue,
  sendViaResend,
  sendingLeaseExpired,
} from '../functions/src/email';

const proposal = (status: string, exists = true) => ({
  exists,
  get: (field: string) => (field === 'status' ? status : undefined),
}) as FirebaseFirestore.DocumentSnapshot;

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
  it('keeps a decision sendable only while that exact decision remains true', () => {
    expect(decisionEmailStillTrue('accepted', proposal('accepted'))).toBe(true);
    expect(decisionEmailStillTrue('accepted', proposal('confirmed'))).toBe(true);
    expect(decisionEmailStillTrue('accepted', proposal('declined'))).toBe(true);
    expect(decisionEmailStillTrue('waitlisted', proposal('waitlisted'))).toBe(true);
    expect(decisionEmailStillTrue('rejected', proposal('rejected'))).toBe(true);
    expect(decisionEmailStillTrue('accepted', proposal('under_review'))).toBe(false);
    expect(decisionEmailStillTrue('rejected', proposal('withdrawn'))).toBe(false);
    expect(decisionEmailStillTrue('submission_received', proposal('submitted'))).toBe(false);
    expect(decisionEmailStillTrue('accepted', proposal('accepted', false))).toBe(false);
  });

  it('pins a reviewed address while leaving automatic rows refreshable', () => {
    expect(
      reviewedRecipientStillTrue(
        { to: 'old@example.org', reviewedTo: 'old@example.org' },
        'old@example.org',
      ),
    ).toBe(true);
    expect(
      reviewedRecipientStillTrue(
        { to: 'old@example.org', reviewedTo: 'old@example.org' },
        'new@example.org',
      ),
    ).toBe(false);
    expect(
      reviewedRecipientStillTrue(
        { to: 'new@example.org', reviewedTo: 'old@example.org' },
        'old@example.org',
      ),
    ).toBe(false);
    expect(reviewedRecipientStillTrue({ to: 'old@example.org' }, 'new@example.org')).toBe(true);
  });

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

  it('configures the Firestore trigger to retry crashes and pace provider requests', () => {
    expect(SEND_QUEUED_EMAIL_TRIGGER_OPTIONS).toMatchObject({
      retry: true,
      document: 'cfps/{cfpId}/emailLog/{logId}',
      concurrency: 1,
    });
    // Resend's account limit is ten requests per second.
    expect(SEND_QUEUED_EMAIL_TRIGGER_OPTIONS.maxInstances).toBeLessThanOrEqual(5);
  });

  it('retries a rate-limited send with the same key after the provider wait', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Too many requests' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'provider-email-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      sendViaResend('speaker@example.org', rendered, 'resend-key', settings, 'attempt-key', {
        wait,
      }),
    ).resolves.toMatchObject({ status: 'sent', providerId: 'provider-email-id' });

    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'Idempotency-Key': 'attempt-key' });
  });

  it('gives up on a persistent rate limit as ambiguous so a retry reuses the key', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      sendViaResend('speaker@example.org', rendered, 'resend-key', settings, 'attempt-key', {
        wait,
      }),
    ).resolves.toMatchObject({ status: 'failed', ambiguous: true, error: '429: Too many requests' });

    expect(fetchMock).toHaveBeenCalledTimes(RESEND_RATE_LIMIT_RETRY.attempts);
    expect(wait).toHaveBeenCalledTimes(RESEND_RATE_LIMIT_RETRY.attempts - 1);
    expect(wait).toHaveBeenCalledWith(RESEND_RATE_LIMIT_RETRY.defaultWaitMs);
  });

  it('bounds the wait taken from the retry-after header', () => {
    expect(rateLimitWaitMs('1')).toBe(1_000);
    expect(rateLimitWaitMs('0.5')).toBe(500);
    expect(rateLimitWaitMs('120')).toBe(RESEND_RATE_LIMIT_RETRY.maxWaitMs);
    expect(rateLimitWaitMs(null)).toBe(RESEND_RATE_LIMIT_RETRY.defaultWaitMs);
    expect(rateLimitWaitMs('soon')).toBe(RESEND_RATE_LIMIT_RETRY.defaultWaitMs);
    expect(rateLimitWaitMs('-3')).toBe(RESEND_RATE_LIMIT_RETRY.defaultWaitMs);
  });

  it('does not retry a rejected request that was not rate limited', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid `to` field' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const wait = vi.fn().mockResolvedValue(undefined);

    const outcome = await sendViaResend(
      'speaker@example.org',
      rendered,
      'resend-key',
      settings,
      'attempt-key',
      { wait },
    );
    expect(outcome).toMatchObject({ status: 'failed', error: '422: Invalid `to` field' });
    expect(outcome).not.toHaveProperty('ambiguous');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
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

  it('keeps the lead log id compatible and scopes additional recipients by uid', () => {
    expect(logId('accepted', 'talk')).toBe('accepted__talk');
    expect(logId('accepted', 'talk', undefined, 'co-speaker')).toBe(
      'accepted__talk__co-speaker',
    );
    expect(logId('schedule_changed', 'talk', 'release-2', 'co-speaker')).toBe(
      'schedule_changed__talk__release-2__co-speaker',
    );
    expect(
      logId('profile_update_requested', 'talk', 'generation-2', 'co-speaker'),
    ).toBe('profile_update_requested__talk__generation-2__co-speaker');
  });

  it('renders co-speaker invitations with the exact server-owned invite destination', async () => {
    const fetchMock = successfulFetch();
    await deliver(
      {
        kind: 'co_speaker_invited',
        proposalId: 'talk-1',
        invitationId: 'invite-1',
        locale: 'en',
        bilingual: true,
        to: 'co@example.org',
        data: { speakerName: 'Co Speaker', title: 'A shared session', needsVisa: false },
      },
      'resend-key',
      settings,
      { id: 'event', name: 'DevFest', publicUrl: 'https://cfp.example.org' },
    );

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      text: string;
      html: string;
    };
    expect(request.text).toContain(
      'https://cfp.example.org/c/event/submit?proposal=talk-1&speakerInvite=invite-1',
    );
    expect(request.html).toContain('speakerInvite=invite-1');
  });

  it('renders profile requests with the exact server-owned proposal destination', async () => {
    const fetchMock = successfulFetch();
    await deliver(
      {
        kind: 'profile_update_requested',
        proposalId: 'talk-1',
        locale: 'en',
        to: 'speaker@example.org',
        data: { speakerName: 'Speaker', title: 'A shared session', needsVisa: false },
      },
      'resend-key',
      settings,
      { id: 'event', name: 'DevFest', publicUrl: 'https://cfp.example.org' },
    );

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      text: string;
      html: string;
    };
    expect(request.text).toContain(
      'https://cfp.example.org/c/event/submit?proposal=talk-1',
    );
    expect(request.html).toContain('proposal=talk-1');
  });
});
