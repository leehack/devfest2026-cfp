import { expect, test } from '@playwright/test';

import {
  callAs,
  callJson,
  createAccount,
  readPublicScheduleEntry,
  readScheduleEntry,
  reset,
  seedMember,
} from './backend';

const ADMIN = {
  sub: 'custom-speaker-admin',
  email: 'custom-speaker-admin@example.org',
  name: 'Custom Speaker Admin',
};

test.beforeEach(async () => {
  await reset();
});

test('custom-item speakers are validated, sanitized, and frozen into releases', async () => {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '18:00' }],
      rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
    },
  });
  const keynote = {
    id: 'opening-keynote',
    kind: 'custom',
    customType: 'keynote',
    language: 'bilingual',
    title: { en: 'Opening keynote', fr: "Conférence d'ouverture" },
    date: '2026-11-14',
    startsAt: '09:00',
    durationMinutes: 45,
    roomId: 'main',
  };

  expect(
    await callAs(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: configured.revision,
      entry: { ...keynote, speakers: [{ name: 42 }] },
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
  expect(
    await callAs(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: configured.revision,
      entry: { ...keynote, speakers: 'Grace Hopper' },
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });

  const speakers = [
    {
      name: '  Grace Hopper  ',
      jobTitle: '  Rear admiral  ',
      company: '  United States Navy  ',
      bio: '  Computer scientist and compiler pioneer.  ',
      email: 'must-not-enter-the-public-release@example.org',
    },
    { name: 'Event host', jobTitle: '', company: '', bio: '' },
  ];
  const saved = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: { ...keynote, speakers },
  });
  const first = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: saved.revision,
  });
  expect((await readScheduleEntry(first.releaseId, keynote.id))?.speakers).toEqual([
    {
      name: 'Grace Hopper',
      jobTitle: 'Rear admiral',
      company: 'United States Navy',
      bio: 'Computer scientist and compiler pioneer.',
    },
    { name: 'Event host' },
  ]);

  const published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: first.revision,
  });
  const changed = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: published.revision,
    entry: { ...keynote, speakers: [{ name: 'Updated keynote speaker' }] },
  });
  expect(
    await callAs(admin.idToken, 'publishSchedule', { expectedRevision: changed.revision }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  const second = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: changed.revision,
  });
  expect(second.releaseId).not.toBe(first.releaseId);
  expect((await readScheduleEntry(second.releaseId, keynote.id))?.speakers).toEqual([
    { name: 'Updated keynote speaker' },
  ]);
  expect((await readPublicScheduleEntry(first.releaseId, keynote.id))?.speakers).toEqual([
    {
      name: 'Grace Hopper',
      jobTitle: 'Rear admiral',
      company: 'United States Navy',
      bio: 'Computer scientist and compiler pioneer.',
    },
    { name: 'Event host' },
  ]);
});
