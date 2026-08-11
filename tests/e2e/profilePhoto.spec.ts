import sharp from 'sharp';
import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  callPublic,
  createAccount,
  readEmailLog,
  readProposal,
  readProposalById,
  readProfileUpdateRequestDirect,
  readPublicScheduleEntry,
  readScheduleConfigDirect,
  readSpeaker,
  readStoredObjects,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  setConfirmFormDirect,
  setScheduleNeedsAttentionDirect,
} from './backend';
import { at, fillRequired, signInAs, type Identity, waitForSave } from './form';
import { FORM_LIMITS, SPEAKER_PHOTO_KEY } from '../../shared/confirmForm';

const ADMIN: Identity = {
  sub: 'profile-photo-admin',
  email: 'profile-photo-admin@example.org',
  name: 'Ada Admin',
};
const SPEAKER: Identity = {
  sub: 'profile-photo-speaker',
  email: 'profile-photo-speaker@example.org',
  name: 'Samira Speaker',
};
const TITLE = 'Reliable releases without the scramble';

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

async function seedAcceptedPhotoSession() {
  const [admin, speaker] = await Promise.all([createAccount(ADMIN), createAccount(SPEAKER)]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedProposal('portrait-session', {
      speakerUid: speaker.uid,
      title: TITLE,
      status: 'accepted',
      speaker: {
        name: SPEAKER.name,
        bio: 'Builds accessible developer tools and helps teams release them safely.',
        company: 'GDG Montreal',
        jobTitle: 'Community organizer',
      },
    }),
  ]);
  await callJson(admin.idToken, 'setConfirmForm', {
    fields: [],
    speakerPhoto: { required: true },
  });
  return { admin, speaker };
}

async function scheduleAndShare(adminToken: string, startsAt: string, expectedRevision: number) {
  const scheduled = await callJson(adminToken, 'upsertScheduleEntry', {
    expectedRevision,
    entry: {
      id: 'portrait-session',
      kind: 'proposal',
      proposalId: 'portrait-session',
      date: '2026-11-14',
      startsAt,
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  return callJson(adminToken, 'shareSchedulePreview', {
    expectedRevision: scheduled.revision,
  });
}

test.beforeEach(async () => {
  await reset();
});

test('a submission can update the optional profile photo without sending it to reviewers', async ({
  page,
}) => {
  const speaker = await createAccount(SPEAKER);
  const original = await portrait(900, 1000, { r: 35, g: 125, b: 185 });

  await signInAs(page, SPEAKER);
  const profile = page.locator('#submission-speaker');
  const photo = profile.locator('.speaker-photo');
  await photo.scrollIntoViewIfNeeded();
  await expect(photo.getByRole('heading', { name: 'Speaker photo' })).toBeVisible();
  await expect(photo.getByText('Optional', { exact: true })).toBeVisible();
  await expect(photo.getByText(/not sent with CFP proposals or shown to reviewers/)).toBeVisible();

  await photo.getByLabel('Choose speaker profile photo').setInputFiles({
    name: 'speaker.png',
    mimeType: 'image/png',
    buffer: original,
  });
  await expect(photo.locator('img.speaker-photo__preview')).toBeVisible();
  await expect
    .poll(async () => (await readSpeaker(speaker.uid))?.profilePhoto?.generation)
    .not.toBeFalsy();

  await fillRequired(page);
  await waitForSave(page);
  await page.getByRole('button', { name: 'Submit proposal' }).click();
  await expect(page.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();

  const proposal = await readProposal();
  expect(proposal?.status).toBe('submitted');
  expect(JSON.stringify(proposal)).not.toContain('speakerProfilePhotos/');
  expect(JSON.stringify(proposal?.speakerSnapshot)).not.toContain('profilePhoto');
});

test('a reusable profile photo is quality-gated and confirmation freezes its exact version', async ({
  page,
}) => {
  const { admin, speaker } = await seedAcceptedPhotoSession();
  const tooSmall = await portrait(
    FORM_LIMITS.speakerPhotoMinEdge - 1,
    FORM_LIMITS.speakerPhotoMinEdge + 100,
    { r: 55, g: 95, b: 170 },
  );
  const original = await portrait(900, 1000, { r: 35, g: 125, b: 185 });
  const replacement = await portrait(1000, 900, { r: 185, g: 75, b: 95 });

  expect(
    await callAs(speaker.idToken, 'respondToDecision', {
      proposalId: 'portrait-session',
      response: 'confirm',
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
  expect((await readProposalById('portrait-session'))?.status).toBe('accepted');

  expect(
    await callAs(speaker.idToken, 'uploadProfilePhoto', {
      contentType: 'image/png',
      base64: tooSmall.toString('base64'),
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });

  await signInAs(page, SPEAKER, '/me');
  const photoInput = page.getByLabel('Choose speaker profile photo');
  await expect(photoInput).toBeEnabled();
  await photoInput.setInputFiles({
    name: 'too-small.png',
    mimeType: 'image/png',
    buffer: tooSmall,
  });
  await expect(
    page.getByText(`Choose a photo at least ${FORM_LIMITS.speakerPhotoMinEdge} pixels on both sides.`),
  ).toBeVisible();

  await photoInput.setInputFiles({
    name: 'speaker.png',
    mimeType: 'image/png',
    buffer: original,
  });
  await expect(page.locator('img.speaker-photo__preview')).toBeVisible();

  const firstProfile = await readSpeaker(speaker.uid);
  expect(firstProfile?.profilePhoto).toMatchObject({
    contentType: 'image/png',
    size: original.length,
  });
  expect(firstProfile?.profilePhoto?.path).toMatch(
    new RegExp(`^speakerProfilePhotos/${speaker.uid}/[^/]+$`),
  );
  expect(
    await callJson(speaker.idToken, 'profilePhotoImage', {}),
  ).toMatchObject({ contentType: 'image/png', base64: original.toString('base64') });

  expect(
    await callAs(speaker.idToken, 'respondToDecision', {
      proposalId: 'portrait-session',
      response: 'confirm',
    }),
  ).toEqual({ ok: true, code: '200' });
  const confirmed = await readProposalById('portrait-session');
  expect(confirmed?.status).toBe('confirmed');
  expect(confirmed?.speakerPhoto).toMatchObject({
    sourceGeneration: firstProfile?.profilePhoto?.generation,
    contentType: 'image/png',
    size: original.length,
  });
  expect(confirmed?.speakerPhoto?.path).toBe(
    `cfps/${CFP_ID}/confirmedHeadshots/portrait-session/${speaker.uid}/${SPEAKER_PHOTO_KEY}/${firstProfile?.profilePhoto?.generation}`,
  );
  const frozen = confirmed?.speakerPhoto;

  await callJson(speaker.idToken, 'uploadProfilePhoto', {
    contentType: 'image/png',
    base64: replacement.toString('base64'),
  });
  const replacedProfile = await readSpeaker(speaker.uid);
  expect(replacedProfile?.profilePhoto?.path).not.toBe(firstProfile?.profilePhoto?.path);
  expect((await readProposalById('portrait-session'))?.speakerPhoto).toEqual(frozen);
  expect(
    await callJson(admin.idToken, 'headshotImage', {
      proposalId: 'portrait-session',
      key: SPEAKER_PHOTO_KEY,
    }),
  ).toEqual({ ok: true, dataUrl: `data:image/png;base64,${original.toString('base64')}` });

  await callJson(speaker.idToken, 'removeProfilePhoto', {});
  expect(
    await callAs(speaker.idToken, 'respondToDecision', {
      proposalId: 'portrait-session',
      response: 'confirm',
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });
  expect((await readProposalById('portrait-session'))?.speakerPhoto).toEqual(frozen);

  await signInAs(page, SPEAKER);
  await expect(page.getByText('This session requires a speaker photo')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove photo from this session' }),
  ).toHaveCount(0);
});

test('confirmation waits for a profile photo replacement and freezes the new generation', async ({
  page,
}) => {
  const { speaker } = await seedAcceptedPhotoSession();
  const original = await portrait(900, 900, { r: 35, g: 125, b: 185 });
  const replacement = await portrait(920, 880, { r: 185, g: 75, b: 95 });
  const firstUpload = await callJson(speaker.idToken, 'uploadProfilePhoto', {
    contentType: 'image/png',
    base64: original.toString('base64'),
  });

  await signInAs(page, SPEAKER);
  const photo = page.locator('#submission-speaker .speaker-photo');
  await photo.scrollIntoViewIfNeeded();
  await expect(photo.locator('img.speaker-photo__preview')).toBeVisible();

  let releaseUpload = () => {};
  let markUploadStarted = () => {};
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve;
  });
  await page.route('**/uploadProfilePhoto', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    markUploadStarted();
    await uploadGate;
    await route.continue();
  });

  await photo.getByLabel('Choose speaker profile photo').setInputFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: replacement,
  });
  await uploadStarted;
  const accept = page.getByRole('button', { name: 'Yes, I can present' });
  await expect(accept).toBeDisabled();
  releaseUpload();
  await expect(accept).toBeEnabled();

  const replacedProfile = await readSpeaker(speaker.uid);
  expect(replacedProfile?.profilePhoto?.generation).not.toBe(firstUpload.generation);
  await accept.click();
  const confirm = page.getByRole('button', { name: 'Confirm my talk' });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect
    .poll(async () => (await readProposalById('portrait-session'))?.status)
    .toBe('confirmed');
  expect((await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration).toBe(
    replacedProfile?.profilePhoto?.generation,
  );
});

test('an optional profile photo can be explicitly removed from a confirmed session', async ({
  page,
}) => {
  const { speaker } = await seedAcceptedPhotoSession();
  // Legacy form documents predate `speakerPhoto`; that absence now means the
  // same optional photo the admin checkbox represents when it is unticked.
  await setConfirmFormDirect([]);
  const original = await portrait(900, 900, { r: 45, g: 135, b: 105 });
  const uploaded = await callJson(speaker.idToken, 'uploadProfilePhoto', {
    contentType: 'image/png',
    base64: original.toString('base64'),
  });
  await callJson(speaker.idToken, 'respondToDecision', {
    proposalId: 'portrait-session',
    response: 'confirm',
  });
  await setScheduleNeedsAttentionDirect(false);
  await callJson(speaker.idToken, 'removeProfilePhoto', {});

  expect((await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration).toBe(
    uploaded.generation,
  );
  await signInAs(page, SPEAKER);
  await expect(page.getByText('Profile photo removed')).toBeVisible();
  expect((await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration).toBe(
    uploaded.generation,
  );
  expect((await readScheduleConfigDirect())?.needsAttention).toBe(false);
  await page.getByRole('button', { name: 'Remove photo from this session' }).click();
  await expect(page.getByText('No photo approved for this session')).toBeVisible();

  await expect
    .poll(async () => (await readProposalById('portrait-session'))?.speakerPhoto)
    .toBeUndefined();
  expect((await readScheduleConfigDirect())?.needsAttention).toBe(true);

  // Uploading from the confirmed-session control remains an explicit approval
  // of that new photo; its existing autosave path does not require a second click.
  await setScheduleNeedsAttentionDirect(false);
  const replacement = await portrait(940, 880, { r: 185, g: 105, b: 45 });
  await page.getByLabel('Choose speaker profile photo').setInputFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: replacement,
  });
  let replacementGeneration = '';
  await expect
    .poll(async () => {
      replacementGeneration = String((await readSpeaker(speaker.uid))?.profilePhoto?.generation ?? '');
      return replacementGeneration.length > 0;
    })
    .toBe(true);
  await expect
    .poll(
      async () =>
        (await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration,
    )
    .toBe(replacementGeneration);
  await expect(page.getByText('Photo approved for this session')).toBeVisible();
  expect((await readScheduleConfigDirect())?.needsAttention).toBe(true);
});

test('a confirmed speaker explicitly adopts a newer profile photo without uploading it again', async ({
  page,
}) => {
  const { admin, speaker } = await seedAcceptedPhotoSession();
  const original = await portrait(920, 860, { r: 35, g: 125, b: 185 });
  const replacement = await portrait(860, 920, { r: 185, g: 75, b: 95 });

  const firstUpload = await callJson(speaker.idToken, 'uploadProfilePhoto', {
    contentType: 'image/png',
    base64: original.toString('base64'),
  });
  await callJson(speaker.idToken, 'respondToDecision', {
    proposalId: 'portrait-session',
    response: 'confirm',
  });
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
    },
  });
  const firstShared = await scheduleAndShare(admin.idToken, '10:00', configured.revision);
  const firstPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: firstShared.revision,
  });
  const firstEntry = await readPublicScheduleEntry(
    firstPublished.releaseId,
    'portrait-session',
  );
  const firstPublicPhoto = await callJson(speaker.idToken, 'publicSchedulePhoto', {
    releaseId: firstPublished.releaseId,
    entryId: 'portrait-session',
    speakerIndex: 0,
  });

  const secondUpload = await callJson(speaker.idToken, 'uploadProfilePhoto', {
    contentType: 'image/png',
    base64: replacement.toString('base64'),
  });
  expect(secondUpload.generation).not.toBe(firstUpload.generation);
  expect((await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration).toBe(
    firstUpload.generation,
  );

  await signInAs(page, SPEAKER);
  await expect(page.getByText('New profile photo available')).toBeVisible();
  expect((await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration).toBe(
    firstUpload.generation,
  );
  expect((await readScheduleConfigDirect())?.needsAttention).toBe(false);
  await page.getByRole('button', { name: 'Use this photo for this session' }).click();
  await expect(page.getByText('Photo approved for this session')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use this photo for this session' }),
  ).toHaveCount(0);

  await expect
    .poll(
      async () =>
        (await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration,
    )
    .toBe(secondUpload.generation);
  expect((await readScheduleConfigDirect())?.needsAttention).toBe(true);

  // Approval changes the working source only. The currently published release
  // still points at the exact bytes and opaque member it had before the click.
  expect(
    await readPublicScheduleEntry(firstPublished.releaseId, 'portrait-session'),
  ).toEqual(firstEntry);
  expect(
    await callJson(speaker.idToken, 'publicSchedulePhoto', {
      releaseId: firstPublished.releaseId,
      entryId: 'portrait-session',
      speakerIndex: 0,
    }),
  ).toEqual(firstPublicPhoto);

  const secondShared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: firstPublished.revision,
  });
  expect(
    (await readEmailLog()).filter(
      (row) => row.dedupeKey === secondShared.releaseId && row.kind === 'schedule_changed',
    ),
  ).toEqual([]);
  const secondPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: secondShared.revision,
  });
  const secondPublicPhoto = await callJson(speaker.idToken, 'publicSchedulePhoto', {
    releaseId: secondPublished.releaseId,
    entryId: 'portrait-session',
    speakerIndex: 0,
  });
  expect(secondPublicPhoto.base64).not.toBe(firstPublicPhoto.base64);
});

test('a photo update request stays pending until the speaker adopts the new profile generation', async () => {
  const { admin, speaker } = await seedAcceptedPhotoSession();
  await seedSpeaker(speaker.uid, {
    name: SPEAKER.name,
    email: SPEAKER.email,
    bio: 'Builds accessible developer tools and helps teams release them safely.',
    company: 'GDG Montreal',
    jobTitle: 'Community organizer',
  });
  const original = await portrait(920, 860, { r: 35, g: 125, b: 185 });
  const replacement = await portrait(860, 920, { r: 185, g: 75, b: 95 });
  const firstUpload = await callJson(speaker.idToken, 'uploadProfilePhoto', {
    contentType: 'image/png',
    base64: original.toString('base64'),
  });
  await callJson(speaker.idToken, 'respondToDecision', {
    proposalId: 'portrait-session',
    response: 'confirm',
  });
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
    },
  });
  const firstShared = await scheduleAndShare(admin.idToken, '10:00', configured.revision);

  const requested = await callJson(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
    proposalId: 'portrait-session',
    speakerUid: speaker.uid,
    scopes: ['photo'],
  });
  expect(requested).toMatchObject({
    created: true,
    request: { status: 'pending', scopes: ['photo'], resolvedScopes: [] },
  });

  const secondUpload = await callJson(speaker.idToken, 'uploadProfilePhoto', {
    contentType: 'image/png',
    base64: replacement.toString('base64'),
  });
  expect(secondUpload.generation).not.toBe(firstUpload.generation);

  const adminPreview = await callJson(admin.idToken, 'previewProposalSpeakerProfile', {
    proposalId: 'portrait-session',
    speakerUid: speaker.uid,
  });
  expect(adminPreview.photo).toEqual({
    enabled: true,
    current: 'present',
    latest: 'present',
    changed: true,
  });
  for (const privatePhotoField of [
    'path',
    'generation',
    'sourceGeneration',
    'uid',
    'base64',
    'dataUrl',
  ]) {
    expect(adminPreview.photo).not.toHaveProperty(privatePhotoField);
  }
  const serialisedPreview = JSON.stringify(adminPreview);
  expect(serialisedPreview).not.toContain(firstUpload.generation);
  expect(serialisedPreview).not.toContain(secondUpload.generation);
  expect(serialisedPreview).not.toContain('speakerProfilePhotos/');
  expect(serialisedPreview).not.toContain('confirmedHeadshots/');
  expect(serialisedPreview).not.toContain(original.toString('base64'));
  expect(serialisedPreview).not.toContain(replacement.toString('base64'));

  expect(
    await callAs(speaker.idToken, 'completeProposalSpeakerProfileUpdate', {
      proposalId: 'portrait-session',
      requestId: requested.request.requestId,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });
  expect((await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration).toBe(
    firstUpload.generation,
  );

  await callJson(speaker.idToken, 'respondToDecision', {
    proposalId: 'portrait-session',
    response: 'confirm',
  });
  expect((await readProposalById('portrait-session'))?.speakerPhoto?.sourceGeneration).toBe(
    secondUpload.generation,
  );
  expect(
    await callJson(speaker.idToken, 'completeProposalSpeakerProfileUpdate', {
      proposalId: 'portrait-session',
      requestId: requested.request.requestId,
    }),
  ).toMatchObject({
    changed: true,
    remainingScopes: [],
    request: { status: 'resolved', resolvedScopes: ['photo'] },
  });
  expect(
    await callJson(admin.idToken, 'listSpeakerProfileUpdateRequests', {}),
  ).toMatchObject({
    admin: [{
      proposalId: 'portrait-session',
      speakerUid: speaker.uid,
      requestId: requested.request.requestId,
      state: 'ready',
    }],
  });
  const reshared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: firstShared.revision,
  });
  expect(reshared.releaseId).not.toBe(firstShared.releaseId);
  expect(
    await callJson(admin.idToken, 'listSpeakerProfileUpdateRequests', {}),
  ).toMatchObject({ admin: [] });
  expect(
    await readProfileUpdateRequestDirect('portrait-session', speaker.uid),
  ).toMatchObject({
    requestId: requested.request.requestId,
    generation: 1,
    status: 'resolved',
    handledReleaseId: reshared.releaseId,
  });
});

test('an optional absent photo request resolves only after the speaker explicitly completes it', async () => {
  const [admin, speaker] = await Promise.all([createAccount(ADMIN), createAccount(SPEAKER)]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(speaker.uid, {
      name: SPEAKER.name,
      email: SPEAKER.email,
      bio: 'Builds accessible developer tools and helps teams release them safely.',
    }),
    seedProposal('optional-photo-request', {
      speakerUid: speaker.uid,
      title: 'An optional photo request with no photo on either side',
      status: 'accepted',
      speaker: {
        name: SPEAKER.name,
        bio: 'Builds accessible developer tools and helps teams release them safely.',
      },
    }),
    setConfirmFormDirect([]),
  ]);
  await callJson(speaker.idToken, 'respondToDecision', {
    proposalId: 'optional-photo-request',
    response: 'confirm',
  });

  const requested = await callJson(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
    proposalId: 'optional-photo-request',
    speakerUid: speaker.uid,
    scopes: ['photo'],
  });
  expect(requested).toMatchObject({
    created: true,
    request: { status: 'pending', scopes: ['photo'], resolvedScopes: [] },
  });
  expect(
    await callJson(speaker.idToken, 'previewProposalSpeakerProfile', {
      proposalId: 'optional-photo-request',
    }),
  ).toMatchObject({
    photo: { enabled: true, current: 'absent', latest: 'absent', changed: false },
    request: { status: 'pending', scopes: ['photo'], resolvedScopes: [] },
  });

  expect(
    await callJson(speaker.idToken, 'completeProposalSpeakerProfileUpdate', {
      proposalId: 'optional-photo-request',
      requestId: requested.request.requestId,
    }),
  ).toMatchObject({
    changed: true,
    remainingScopes: [],
    request: { status: 'resolved', resolvedScopes: ['photo'] },
  });
});

test('only the current public release serves opaque 512px photos in agenda and detail', async ({
  page,
}) => {
  const { admin, speaker } = await seedAcceptedPhotoSession();
  await setConfirmFormDirect([]);
  const original = await portrait(960, 840, { r: 45, g: 135, b: 105 });
  await callJson(speaker.idToken, 'uploadProfilePhoto', {
    contentType: 'image/png',
    base64: original.toString('base64'),
  });
  await callJson(speaker.idToken, 'respondToDecision', {
    proposalId: 'portrait-session',
    response: 'confirm',
  });

  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
    },
  });
  const firstShared = await scheduleAndShare(admin.idToken, '10:00', configured.revision);

  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: firstShared.releaseId,
      entryId: 'portrait-session',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });

  const firstPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: firstShared.revision,
  });
  const firstEntry = await readPublicScheduleEntry(
    firstPublished.releaseId,
    'portrait-session',
  );
  const publicSpeaker = firstEntry?.session?.speakers?.[0];
  expect(publicSpeaker).toMatchObject({
    name: SPEAKER.name,
    company: 'GDG Montreal',
    jobTitle: 'Community organizer',
  });
  expect(publicSpeaker?.photoRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(publicSpeaker).not.toHaveProperty('uid');
  expect(publicSpeaker).not.toHaveProperty('path');
  expect(publicSpeaker).not.toHaveProperty('generation');
  expect(JSON.stringify(firstEntry)).not.toContain('speakerProfilePhotos/');
  expect(JSON.stringify(firstEntry)).not.toContain('confirmedHeadshots/');
  expect(JSON.stringify(firstEntry)).not.toContain(speaker.uid);

  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: firstPublished.releaseId,
      entryId: 'portrait-session',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: true, code: '200' });
  const publicImage = await callJson(speaker.idToken, 'publicSchedulePhoto', {
    releaseId: firstPublished.releaseId,
    entryId: 'portrait-session',
    speakerIndex: 0,
  });
  expect(publicImage.contentType).toBe('image/webp');
  const metadata = await sharp(Buffer.from(publicImage.base64, 'base64')).metadata();
  expect(metadata).toMatchObject({
    format: 'webp',
    width: FORM_LIMITS.speakerPhotoPublicSize,
    height: FORM_LIMITS.speakerPhotoPublicSize,
  });
  expect(
    await readStoredObjects(
      `cfps/${CFP_ID}/publicSchedulePhotos/${firstPublished.releaseId}/`,
    ),
  ).toEqual([
    `cfps/${CFP_ID}/publicSchedulePhotos/${firstPublished.releaseId}/${publicSpeaker.photoRef}.webp`,
  ]);

  for (const input of [
    {
      releaseId: firstPublished.releaseId,
      entryId: 'not-this-entry',
      speakerIndex: 0,
    },
    {
      releaseId: firstPublished.releaseId,
      entryId: 'portrait-session',
      speakerIndex: 1,
    },
  ]) {
    expect(await callPublic('publicSchedulePhoto', input)).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  }

  await page.goto(at('/schedule'));
  const sessionLink = page.getByRole('link', { name: TITLE });
  const agendaItem = page.locator('.agenda-item', { has: sessionLink });
  await expect(agendaItem.locator('.public-speaker-photo img')).toBeVisible();
  await sessionLink.click();
  await expect(page).toHaveURL(at('/schedule/portrait-session'));
  await expect(
    page.locator('.session-speaker', { hasText: SPEAKER.name }).locator('.public-speaker-photo img'),
  ).toBeVisible();

  const secondShared = await scheduleAndShare(
    admin.idToken,
    '10:15',
    firstPublished.revision,
  );
  const secondPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: secondShared.revision,
  });
  const secondEntry = await readPublicScheduleEntry(
    secondPublished.releaseId,
    'portrait-session',
  );
  expect(secondEntry?.session?.speakers?.[0]?.photoRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(secondEntry?.session?.speakers?.[0]?.photoRef).not.toBe(publicSpeaker.photoRef);
  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: firstPublished.releaseId,
      entryId: 'portrait-session',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });
  expect(
    await callPublic('publicSchedulePhoto', {
      releaseId: secondPublished.releaseId,
      entryId: 'portrait-session',
      speakerIndex: 0,
    }),
  ).toEqual({ ok: true, code: '200' });
});
