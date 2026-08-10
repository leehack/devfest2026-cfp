import { expect, test } from '@playwright/test';

import { DEFAULT_SUBMISSION_FORM } from '@shared/submissionForm';
import {
  callAs,
  callJson,
  createAccount,
  makeScheduleReleaseLegacyDirect,
  readScheduleEntry,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
} from './backend';
import { at, signInAs } from './form';

const ADMIN = {
  sub: 'schedule-taxonomy-admin',
  email: 'schedule-taxonomy-admin@example.org',
  name: 'Schedule Taxonomy Admin',
};
const SPEAKER = {
  sub: 'schedule-taxonomy-speaker',
  email: 'schedule-taxonomy-speaker@example.org',
  name: 'Schedule Taxonomy Speaker',
};

test.beforeEach(async () => {
  await reset();
});

const formWithCategory = (en: string, fr: string) => ({
  ...DEFAULT_SUBMISSION_FORM,
  category: [{ value: 'ai_ml', label: { en, fr } }],
});

test('schedule releases freeze taxonomy labels and refuse a changed form until re-shared', async () => {
  const [admin, speaker] = await Promise.all([
    createAccount(ADMIN),
    createAccount(SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email }),
    seedProposal('taxonomy-talk', {
      speakerUid: speaker.uid,
      title: 'Taxonomy labels are release content',
      status: 'confirmed',
      category: 'ai_ml',
      format: 'session_40',
      level: 'intermediate',
    }),
  ]);

  await callJson(admin.idToken, 'setSubmissionForm', formWithCategory('AI systems', 'Systèmes IA'));
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
    },
  });
  const scheduled = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: {
      id: 'taxonomy-talk',
      kind: 'proposal',
      proposalId: 'taxonomy-talk',
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  const first = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: scheduled.revision,
  });

  expect(await readScheduleEntry(first.releaseId, 'taxonomy-talk')).toMatchObject({
    session: {
      category: 'ai_ml',
      categoryLabel: { en: 'AI systems', fr: 'Systèmes IA' },
      format: 'session_40',
      formatLabel: DEFAULT_SUBMISSION_FORM.format[0].label,
      level: 'intermediate',
      levelLabel: DEFAULT_SUBMISSION_FORM.level[1].label,
    },
  });

  await callJson(
    admin.idToken,
    'setSubmissionForm',
    formWithCategory('Applied AI', 'IA appliquée'),
  );
  expect(await callJson(admin.idToken, 'getSharedSchedule', {})).toMatchObject({ stale: true });
  expect(
    await callAs(admin.idToken, 'publishSchedule', { expectedRevision: first.revision }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  const second = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: first.revision,
  });
  expect(second.releaseId).not.toBe(first.releaseId);
  expect(await readScheduleEntry(first.releaseId, 'taxonomy-talk')).toMatchObject({
    session: { categoryLabel: { en: 'AI systems', fr: 'Systèmes IA' } },
  });
  expect(await readScheduleEntry(second.releaseId, 'taxonomy-talk')).toMatchObject({
    session: { categoryLabel: { en: 'Applied AI', fr: 'IA appliquée' } },
  });
  await expect(
    callJson(admin.idToken, 'publishSchedule', { expectedRevision: second.revision }),
  ).resolves.toMatchObject({ releaseId: second.releaseId });
});

test('a legacy release remains visible to its speaker and upgradeable by its admin', async ({
  page,
}) => {
  const [admin, speaker] = await Promise.all([
    createAccount(ADMIN),
    createAccount(SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email }),
    seedProposal('legacy-taxonomy-talk', {
      speakerUid: speaker.uid,
      title: 'Legacy taxonomy release',
      status: 'confirmed',
      category: 'ai_ml',
      format: 'session_40',
      level: 'intermediate',
    }),
  ]);
  await callJson(admin.idToken, 'setSubmissionForm', formWithCategory('AI systems', 'Systèmes IA'));
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
    },
  });
  const scheduled = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: {
      id: 'legacy-taxonomy-talk',
      kind: 'proposal',
      proposalId: 'legacy-taxonomy-talk',
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  const shared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: scheduled.revision,
  });
  await makeScheduleReleaseLegacyDirect(shared.releaseId, ['legacy-taxonomy-talk']);

  const placement = await callJson(speaker.idToken, 'getSharedSchedule', {});
  expect(placement).toMatchObject({ audience: 'speaker', stale: false });
  expect(placement.entries).toHaveLength(1);
  expect(placement.entries[0]).toMatchObject({
    id: 'legacy-taxonomy-talk',
    session: { category: 'ai_ml', format: 'session_40', level: 'intermediate' },
  });
  expect(placement.entries[0].session).not.toHaveProperty('categoryLabel');

  await signInAs(page, ADMIN, at('/admin/schedule'));
  await expect(page.getByRole('button', { name: 'Review and share' })).toBeEnabled();
});
