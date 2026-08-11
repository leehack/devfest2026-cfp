import { describe, expect, it } from 'vitest';

import { speakerSnapshotFrom } from '../functions/src/profileSnapshots';

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
});
