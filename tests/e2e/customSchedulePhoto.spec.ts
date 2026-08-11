import sharp from 'sharp';
import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  callPublic,
  createAccount,
  readPublicScheduleEntry,
  readScheduleEntry,
  reset,
  seedMember,
} from './backend';
import type { Identity } from './form';
import { FORM_LIMITS } from '../../shared/confirmForm';

const PROJECT = 'demo-devfest-cfp';
const FIRESTORE = 'http://127.0.0.1:8080';
const FUNCTIONS = 'http://127.0.0.1:5001';
const REGION = 'northamerica-northeast1';
const DOCS = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;

const ADMIN: Identity = {
  sub: 'custom-photo-admin',
  email: 'custom-photo-admin@example.org',
  name: 'Ari Admin',
};
const REVIEWER: Identity = {
  sub: 'custom-photo-reviewer',
  email: 'custom-photo-reviewer@example.org',
  name: 'Riley Reviewer',
};
const SPEAKER: Identity = {
  sub: 'custom-photo-speaker',
  email: 'custom-photo-speaker@example.org',
  name: 'Sam Speaker',
};

const config = {
  timeZone: 'America/Toronto',
  revision: 0,
  days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
  rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
};

async function portrait(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background },
  })
    .png()
    .toBuffer();
}

function customEntry(photoAssetRef?: string) {
  return {
    id: 'community-keynote',
    kind: 'custom',
    customType: 'keynote',
    language: 'bilingual',
    title: { en: 'Community keynote', fr: 'Conférence communautaire' },
    description: {
      en: 'A programme-owned keynote outside the CFP roster.',
      fr: 'Une conférence ajoutée directement au programme.',
    },
    speakers: [
      {
        name: 'Jordan Guest',
        bio: 'Builds durable community infrastructure.',
        company: 'Community Lab',
        jobTitle: 'Director',
        ...(photoAssetRef ? { photoAssetRef } : {}),
      },
    ],
    date: '2026-11-14',
    startsAt: '10:00',
    durationMinutes: 40,
    roomId: 'main',
  };
}

async function configureSchedule() {
  const [admin, reviewer, speaker] = await Promise.all(
    [ADMIN, REVIEWER, SPEAKER].map(createAccount),
  );
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedMember(reviewer.uid, 'reviewer', undefined, REVIEWER.email),
  ]);
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    config,
    expectedRevision: 0,
  });
  return { admin, reviewer, speaker, revision: configured.revision as number };
}

async function readRawDraftSpeaker(entryId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${DOCS}/cfps/${CFP_ID}/scheduleDraft/${entryId}`, {
    headers: { authorization: 'Bearer owner' },
  });
  expect(response.ok).toBe(true);
  const body = (await response.json()) as {
    fields?: {
      speakers?: {
        arrayValue?: {
          values?: Array<{ mapValue?: { fields?: Record<string, unknown> } }>;
        };
      };
    };
  };
  return body.fields?.speakers?.arrayValue?.values?.[0]?.mapValue?.fields ?? {};
}

async function callAnonymousJson(name: string, data: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${FUNCTIONS}/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: { cfpId: CFP_ID, ...data } }),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { result?: unknown }).result;
}

test.beforeEach(async () => {
  await reset();
});

test('programme speaker originals are quality-gated admin assets and drafts store only their opaque ref', async () => {
  const { admin, reviewer, speaker, revision } = await configureSchedule();
  const tiny = await portrait(
    FORM_LIMITS.speakerPhotoMinEdge - 1,
    FORM_LIMITS.speakerPhotoMinEdge + 50,
    { r: 45, g: 95, b: 175 },
  );
  const original = await portrait(920, 860, { r: 35, g: 125, b: 185 });
  const upload = { contentType: 'image/png', base64: original.toString('base64') };

  expect(await callPublic('uploadCustomScheduleSpeakerPhoto', upload)).toEqual({
    ok: false,
    code: 'UNAUTHENTICATED',
  });
  expect(await callAs(reviewer.idToken, 'uploadCustomScheduleSpeakerPhoto', upload)).toEqual({
    ok: false,
    code: 'PERMISSION_DENIED',
  });
  expect(await callAs(speaker.idToken, 'uploadCustomScheduleSpeakerPhoto', upload)).toEqual({
    ok: false,
    code: 'PERMISSION_DENIED',
  });
  expect(
    await callAs(admin.idToken, 'uploadCustomScheduleSpeakerPhoto', {
      contentType: 'image/png',
      base64: tiny.toString('base64'),
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
  expect(
    await callAs(admin.idToken, 'uploadCustomScheduleSpeakerPhoto', {
      contentType: 'image/jpeg',
      base64: original.toString('base64'),
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
  expect(
    await callAs(admin.idToken, 'uploadCustomScheduleSpeakerPhoto', {
      contentType: 'image/gif',
      base64: original.toString('base64'),
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });

  const uploaded = await callJson(admin.idToken, 'uploadCustomScheduleSpeakerPhoto', upload);
  expect(uploaded.assetRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const adminPreview = await callJson(admin.idToken, 'customScheduleSpeakerPhotoImage', {
    assetRef: uploaded.assetRef,
  });
  expect(adminPreview).toMatchObject({ ok: true, contentType: 'image/webp' });
  expect(await sharp(Buffer.from(adminPreview.base64, 'base64')).metadata()).toMatchObject({
    format: 'webp',
    width: FORM_LIMITS.speakerPhotoPublicSize,
    height: FORM_LIMITS.speakerPhotoPublicSize,
  });
  expect(
    await callPublic('customScheduleSpeakerPhotoImage', { assetRef: uploaded.assetRef }),
  ).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
  expect(
    await callAs(reviewer.idToken, 'customScheduleSpeakerPhotoImage', {
      assetRef: uploaded.assetRef,
    }),
  ).toEqual({ ok: false, code: 'PERMISSION_DENIED' });

  expect(
    await callAs(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: revision,
      entry: customEntry('cfps/forged/private-bucket-path'),
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
  expect(
    await callAs(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: revision,
      entry: customEntry('a'.repeat(43)),
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: revision,
    entry: customEntry(uploaded.assetRef),
  });
  const rawSpeaker = await readRawDraftSpeaker('community-keynote');
  expect(rawSpeaker).toMatchObject({
    name: { stringValue: 'Jordan Guest' },
    photoAssetRef: { stringValue: uploaded.assetRef },
  });
  expect(rawSpeaker).not.toHaveProperty('photoRef');
  expect(rawSpeaker).not.toHaveProperty('path');
  expect(rawSpeaker).not.toHaveProperty('generation');
  expect(rawSpeaker).not.toHaveProperty('base64');
  expect(JSON.stringify(rawSpeaker)).not.toContain(`cfps/${CFP_ID}/`);
});

test('custom programme photos are immutable per public release through replace and remove', async () => {
  const { admin, revision } = await configureSchedule();
  const original = await portrait(960, 840, { r: 45, g: 135, b: 105 });
  const replacement = await portrait(840, 960, { r: 185, g: 75, b: 95 });
  const firstAsset = await callJson(admin.idToken, 'uploadCustomScheduleSpeakerPhoto', {
    contentType: 'image/png',
    base64: original.toString('base64'),
  });
  const firstSaved = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: revision,
    entry: customEntry(firstAsset.assetRef),
  });
  const firstShared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: firstSaved.revision,
  });
  const firstEntry = await readScheduleEntry(firstShared.releaseId, 'community-keynote');
  const firstSpeaker = firstEntry?.speakers?.[0];
  expect(firstSpeaker).toMatchObject({
    name: 'Jordan Guest',
    bio: 'Builds durable community infrastructure.',
    company: 'Community Lab',
    jobTitle: 'Director',
  });
  expect(firstSpeaker?.photoRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(firstSpeaker).not.toHaveProperty('photoAssetRef');
  expect(firstSpeaker).not.toHaveProperty('path');
  expect(firstSpeaker).not.toHaveProperty('generation');
  expect(JSON.stringify(firstEntry)).not.toContain(firstAsset.assetRef);
  expect(JSON.stringify(firstEntry)).not.toContain(`cfps/${CFP_ID}/`);

  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: firstShared.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });

  const firstPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: firstShared.revision,
  });
  const firstPublicEntry = await readPublicScheduleEntry(
    firstPublished.releaseId,
    'community-keynote',
  );
  expect(firstPublicEntry).toEqual(firstEntry);
  const firstPublicPhoto = await callAnonymousJson('publicSchedulePhoto', {
    releaseId: firstPublished.releaseId,
    entryId: 'community-keynote',
    speakerIndex: 0,
  });
  expect(firstPublicPhoto).toMatchObject({ ok: true, contentType: 'image/webp' });
  expect(
    await sharp(Buffer.from(firstPublicPhoto.base64, 'base64')).metadata(),
  ).toMatchObject({
    format: 'webp',
    width: FORM_LIMITS.speakerPhotoPublicSize,
    height: FORM_LIMITS.speakerPhotoPublicSize,
  });
  for (const probe of [
    { entryId: 'another-entry', speakerIndex: 0 },
    { entryId: 'community-keynote', speakerIndex: 1 },
  ]) {
    expect(
      await callPublic('publicSchedulePhoto', {
        releaseId: firstPublished.releaseId,
        ...probe,
      }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
  }

  const secondAsset = await callJson(admin.idToken, 'uploadCustomScheduleSpeakerPhoto', {
    contentType: 'image/png',
    base64: replacement.toString('base64'),
  });
  expect(secondAsset.assetRef).not.toBe(firstAsset.assetRef);
  const replaced = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: firstPublished.revision,
    entry: customEntry(secondAsset.assetRef),
  });
  expect(
    await readPublicScheduleEntry(firstPublished.releaseId, 'community-keynote'),
  ).toEqual(firstPublicEntry);
  expect(
    await callAnonymousJson('publicSchedulePhoto', {
      releaseId: firstPublished.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual(firstPublicPhoto);

  const secondShared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: replaced.revision,
  });
  const secondEntry = await readScheduleEntry(secondShared.releaseId, 'community-keynote');
  expect(secondEntry?.speakers?.[0]?.photoRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(secondEntry?.speakers?.[0]?.photoRef).not.toBe(firstSpeaker.photoRef);
  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: secondShared.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });
  expect(
    await callAnonymousJson('publicSchedulePhoto', {
      releaseId: firstPublished.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual(firstPublicPhoto);

  const secondPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: secondShared.revision,
  });
  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: firstPublished.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });
  const secondPublicPhoto = await callAnonymousJson('publicSchedulePhoto', {
    releaseId: secondPublished.releaseId,
    entryId: 'community-keynote',
    speakerIndex: 0,
  });
  expect(secondPublicPhoto.contentType).toBe('image/webp');
  expect(secondPublicPhoto.base64).not.toBe(firstPublicPhoto.base64);

  const removed = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: secondPublished.revision,
    entry: customEntry(),
  });
  expect(
    await callAnonymousJson('publicSchedulePhoto', {
      releaseId: secondPublished.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual(secondPublicPhoto);
  const thirdShared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: removed.revision,
  });
  const thirdEntry = await readScheduleEntry(thirdShared.releaseId, 'community-keynote');
  expect(thirdEntry?.speakers?.[0]).not.toHaveProperty('photoRef');
  expect(
    await callAnonymousJson('publicSchedulePhoto', {
      releaseId: secondPublished.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual(secondPublicPhoto);
  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: thirdShared.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });

  const thirdPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: thirdShared.revision,
  });
  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: secondPublished.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });
  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: thirdPublished.releaseId,
      entryId: 'community-keynote',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });
});
