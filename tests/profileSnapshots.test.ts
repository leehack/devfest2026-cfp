import { describe, expect, it } from 'vitest';

import {
  cancelPendingProfileUpdateRequest,
  completedProfileUpdateScopes,
  speakerProfilePreviewChanges,
  speakerProfilePreviewFingerprint,
  speakerProfilePreviewFrom,
  speakerSnapshotFrom,
} from '../functions/src/profileSnapshots';
import type { SpeakerProfileUpdateRequestState } from '../shared/types';

describe('proposal speaker profile snapshots', () => {
  it('copies only the public profile whitelist', () => {
    expect(
      speakerSnapshotFrom('speaker-1', {
        name: 'Leila Haddad',
        bio: 'A production engineer focused on reliable AI systems.',
        company: 'Northstar Labs',
        jobTitle: 'Staff Engineer',
        basedIn: 'Montréal, QC',
        socials: [{ platform: 'linkedin', handle: 'leila-haddad' }],
        isGde: true,
        pastTalks: 'https://example.org/talk',
        sessionizeUrl: 'https://sessionize.com/leila-haddad',
        email: 'private@example.org',
        dietaryNeeds: 'Private answer',
        profilePhoto: { path: 'speakerProfilePhotos/private/original.jpg' },
      }),
    ).toEqual({
      uid: 'speaker-1',
      name: 'Leila Haddad',
      bio: 'A production engineer focused on reliable AI systems.',
      company: 'Northstar Labs',
      jobTitle: 'Staff Engineer',
      basedIn: 'Montréal, QC',
      socials: [{ platform: 'linkedin', handle: 'leila-haddad' }],
      isGde: true,
      pastTalks: 'https://example.org/talk',
      sessionizeUrl: 'https://sessionize.com/leila-haddad',
    });
  });

  it('drops optional public fields that were removed from the global profile', () => {
    expect(
      speakerSnapshotFrom('speaker-1', {
        name: 'Leila Haddad',
        bio: 'A production engineer focused on reliable AI systems.',
        basedIn: 'Montréal, QC',
        socials: [],
        isGde: false,
      }),
    ).toEqual({
      uid: 'speaker-1',
      name: 'Leila Haddad',
      bio: 'A production engineer focused on reliable AI systems.',
      basedIn: 'Montréal, QC',
      socials: [],
      isGde: false,
    });
  });

  it('shows only adoptable fields and keeps an organiser from learning private profile data', () => {
    const profile = {
      name: 'Leila Haddad',
      bio: 'A production engineer focused on reliable AI systems.',
      company: 'Northstar Labs',
      jobTitle: 'Staff Engineer',
      basedIn: 'A newer private location',
      socials: [{ platform: 'linkedin', handle: 'leila-haddad' }],
      isGde: true,
      pastTalks: 'https://example.org/talk',
      sessionizeUrl: 'https://sessionize.com/leila-haddad',
      email: 'private@example.org',
      attendance: { status: 'pending', needsVisa: true },
      acks: { coc: true },
      answers: { shirtSize: 'M' },
      profilePhoto: { path: 'speakerProfilePhotos/private/original.jpg' },
    };

    expect(speakerProfilePreviewFrom(profile)).toEqual({
      name: profile.name,
      bio: profile.bio,
      company: profile.company,
      jobTitle: profile.jobTitle,
      socials: profile.socials,
      isGde: true,
      pastTalks: profile.pastTalks,
      sessionizeUrl: profile.sessionizeUrl,
    });
    expect(speakerProfilePreviewFrom(profile, true)).toMatchObject({
      basedIn: 'A newer private location',
    });
  });

  it('returns field-level changes and stable preview concurrency fingerprints', () => {
    const current = speakerProfilePreviewFrom({
      name: 'Old name',
      bio: 'Old biography',
      socials: [],
      isGde: false,
    });
    const latest = speakerProfilePreviewFrom({
      name: 'New name',
      bio: 'Old biography',
      socials: [],
      isGde: true,
    });

    expect(speakerProfilePreviewChanges(current, latest)).toEqual([
      { field: 'name', before: 'Old name', after: 'New name' },
      { field: 'isGde', before: false, after: true },
    ]);
    expect(speakerProfilePreviewFingerprint(current)).toHaveLength(64);
    expect(speakerProfilePreviewFingerprint(current)).not.toBe(
      speakerProfilePreviewFingerprint(latest),
    );
  });

  it('completes only requested scopes that are ready', () => {
    const request: SpeakerProfileUpdateRequestState = {
      requestId: 'request-1',
      generation: 1,
      status: 'pending',
      scopes: ['profile', 'photo'],
      resolvedScopes: ['profile'],
      requestedAt: null,
    };
    expect(completedProfileUpdateScopes(request, ['photo'])).toEqual(['profile', 'photo']);
    expect(completedProfileUpdateScopes(request, ['profile'])).toEqual(['profile']);
  });

  it('terminates a pending request when its speaker lifecycle is invalidated', () => {
    const updates: Array<Record<string, unknown>> = [];
    const tx = {
      update: (_ref: unknown, data: Record<string, unknown>) => updates.push(data),
    };
    const request = {
      exists: true,
      ref: { path: 'request' },
      get: (field: string) => field === 'status' ? 'pending' : undefined,
    };

    expect(
      cancelPendingProfileUpdateRequest(
        tx as never,
        request as never,
        'speaker-1',
        'speaker-removed',
      ),
    ).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'speaker-1',
      cancellationReason: 'speaker-removed',
    });
  });
});
