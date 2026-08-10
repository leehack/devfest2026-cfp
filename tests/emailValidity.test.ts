import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deliver,
  roleInvitationStillTrue,
  staffEmailLanguage,
  staffMemberIsActive,
  staffNotificationStillTrue,
} from '../functions/src/email';

afterEach(() => vi.unstubAllGlobals());

const snapshot = (data?: Record<string, unknown>) =>
  ({
    exists: data !== undefined,
    get: (field: string) => data?.[field],
  }) as FirebaseFirestore.DocumentSnapshot;

describe('staff email validity', () => {
  it('honours an explicit event locale and otherwise chooses one bilingual message', () => {
    expect(staffEmailLanguage({ locale: 'fr' })).toEqual({ locale: 'fr', bilingual: false });
    expect(staffEmailLanguage({ locale: 'en' })).toEqual({ locale: 'en', bilingual: false });
    expect(staffEmailLanguage(undefined)).toEqual({ locale: 'en', bilingual: true });
    expect(staffEmailLanguage({ locale: 'es' })).toEqual({ locale: 'en', bilingual: true });
  });

  it('delivers unknown staff language bilingually and an explicit French preference in French', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const settings = {
      from: 'DevFest <cfp@example.org>',
      replyTo: 'team@example.org',
      publicUrl: 'https://cfp.example.org',
    };
    const cfp = {
      id: 'event-a',
      name: 'Example Event',
      publicUrl: 'https://cfp.example.org',
    };
    const row = {
      kind: 'committee_proposal_submitted',
      to: 'reviewer@example.org',
      data: { speakerName: 'Riley', title: '' },
    };

    await expect(deliver({ ...row, locale: 'en', bilingual: true }, 'resend-key', settings, cfp))
      .resolves.toMatchObject({ status: 'sent' });
    await expect(deliver({ ...row, locale: 'fr', bilingual: false }, 'resend-key', settings, cfp))
      .resolves.toMatchObject({ status: 'sent' });

    const bilingual = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(bilingual.subject).toContain(' / ');
    expect(bilingual.text).toContain('--- Français ---');
    const french = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(french.subject).toBe('Nouvelle proposition à évaluer pour Example Event');
    expect(french.text).not.toContain('--- Français ---');
  });

  it('requires an exact active event membership', () => {
    expect(
      staffMemberIsActive(
        { cfpId: 'event-a', uid: 'reviewer', role: 'reviewer' },
        'event-a',
        'reviewer',
      ),
    ).toBe(true);
    expect(
      staffMemberIsActive(
        { cfpId: 'event-b', uid: 'reviewer', role: 'reviewer' },
        'event-a',
        'reviewer',
      ),
    ).toBe(false);
    expect(
      staffMemberIsActive(
        { cfpId: 'event-a', uid: 'reviewer', role: 'creator' },
        'event-a',
        'reviewer',
      ),
    ).toBe(false);
  });

  it('supersedes proposal notices after the review queue closes for that proposal', () => {
    for (const status of ['submitted', 'under_review']) {
      expect(
        staffNotificationStillTrue(
          'committee_proposal_submitted',
          'proposal-a',
          snapshot({ status }),
        ),
      ).toBe(true);
    }
    for (const status of ['withdrawn', 'accepted', 'rejected']) {
      expect(
        staffNotificationStillTrue(
          'committee_proposal_submitted',
          'proposal-a',
          snapshot({ status }),
        ),
      ).toBe(false);
    }
  });

  it('supersedes a schedule notice when a newer shared release replaces it', () => {
    expect(
      staffNotificationStillTrue(
        'committee_schedule_shared',
        'release-current',
        snapshot({ sharedScheduleId: 'release-current' }),
      ),
    ).toBe(true);
    expect(
      staffNotificationStillTrue(
        'committee_schedule_shared',
        'release-old',
        snapshot({ sharedScheduleId: 'release-current' }),
      ),
    ).toBe(false);
  });

  it('keeps only the exact unclaimed role invitation sendable', () => {
    const pending = {
      cfpId: 'event-a',
      email: 'reviewer@example.org',
      role: 'reviewer',
      invitationId: 'invite-a',
    };
    expect(
      roleInvitationStillTrue(
        'committee_role_invited',
        'invite-a',
        'event-a',
        'reviewer@example.org',
        snapshot(pending),
      ),
    ).toBe(true);
    expect(
      roleInvitationStillTrue(
        'committee_role_invited',
        'invite-a',
        'event-a',
        'reviewer@example.org',
        snapshot({ ...pending, claimedBy: 'reviewer' }),
      ),
    ).toBe(false);
    expect(
      roleInvitationStillTrue(
        'committee_role_invited',
        'invite-old',
        'event-a',
        'reviewer@example.org',
        snapshot(pending),
      ),
    ).toBe(false);
  });
});
