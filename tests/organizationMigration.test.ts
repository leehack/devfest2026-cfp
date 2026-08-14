import { describe, expect, it } from 'vitest';
// @ts-expect-error The production migration is an executable JavaScript module.
import { parseMigrationArgs, resolveOwnerUid } from '../scripts/migrate-single-cfp-to-org.mjs';

const required = [
  '--project',
  'project-one',
  '--cfp',
  'event-one',
  '--org',
  'org-one',
  '--org-name',
  'Organization One',
];

describe('single-CFP organization migration', () => {
  it('is a prepare dry run unless writes are explicitly confirmed', () => {
    expect(parseMigrationArgs(required, {})).toMatchObject({
      projectId: 'project-one',
      cfpId: 'event-one',
      orgId: 'org-one',
      orgName: 'Organization One',
      phase: 'prepare',
      activeEventLimit: 1,
      apply: false,
      emulated: false,
    });
  });

  it('requires the exact project id before applying writes', () => {
    expect(() => parseMigrationArgs([...required, '--apply'], {})).toThrow(/confirm-project/);
    expect(() =>
      parseMigrationArgs(
        [...required, '--apply', '--confirm-project', 'project-two'],
        {},
      ),
    ).toThrow(/confirm-project/);
    expect(
      parseMigrationArgs(
        [...required, '--apply', '--confirm-project', 'project-one'],
        {},
      ).apply,
    ).toBe(true);
  });

  it('accepts finalize without an organization name', () => {
    expect(
      parseMigrationArgs(
        [
          '--project',
          'project-one',
          '--cfp',
          'event-one',
          '--org',
          'org-one',
          '--phase',
          'finalize',
        ],
        {},
      ).phase,
    ).toBe('finalize');
  });

  it('refuses conflicting project or partially emulated environments', () => {
    expect(() =>
      parseMigrationArgs(required, {
        GCLOUD_PROJECT: 'project-one',
        GOOGLE_CLOUD_PROJECT: 'project-two',
      }),
    ).toThrow(/do not match/);
    expect(() =>
      parseMigrationArgs(required, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }),
    ).toThrow(/both be set/);
    expect(
      parseMigrationArgs(required, {
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      }).emulated,
    ).toBe(true);
  });

  it('resolves only one owner whose membership matches', () => {
    expect(resolveOwnerUid({ ownerUids: ['owner-one'] }, ['owner-one'])).toBe('owner-one');
    expect(
      resolveOwnerUid({ ownerUid: 'owner-one', ownerUids: ['owner-one'] }, ['owner-one']),
    ).toBe('owner-one');
    expect(() => resolveOwnerUid({ ownerUids: ['one', 'two'] }, ['one'])).toThrow(/exactly one/);
    expect(() => resolveOwnerUid({ ownerUids: ['one'] }, ['two'])).toThrow(/do not match/);
    expect(() =>
      resolveOwnerUid({ ownerUid: 'one', ownerUids: ['two'] }, ['one']),
    ).toThrow(/disagree/);
  });
});
