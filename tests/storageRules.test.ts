/**
 * Cloud Storage rules. Runs under `npm run test:rules`.
 *
 * The bucket holds photographs of people's faces, collected once they are on
 * the programme. There is exactly one shape of object it should accept and one
 * person who should be able to read each one, so the tests are mostly about
 * everything else being refused.
 */

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'demo-devfest-cfp';
const SPEAKER = 'speaker-anna';
const OTHER = 'speaker-bruno';

let env: RulesTestEnvironment;

const VERIFIED = { email_verified: true };
const asSpeaker = () => env.authenticatedContext(SPEAKER, VERIFIED).storage();
const asOther = () => env.authenticatedContext(OTHER, VERIFIED).storage();
const asUnverified = () => env.authenticatedContext(SPEAKER, {}).storage();
const asStranger = () => env.unauthenticatedContext().storage();

const jpeg = { contentType: 'image/jpeg' };
const bytes = (size = 32) => new Uint8Array(size);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => env.clearStorage());

describe('headshots belong to one speaker', () => {
  it('lets a speaker upload their own', async () => {
    await assertSucceeds(uploadBytes(ref(asSpeaker(), `headshots/${SPEAKER}/photo`), bytes(), jpeg));
  });

  it('lets them replace it — a photo they dislike is not permanent', async () => {
    await assertSucceeds(uploadBytes(ref(asSpeaker(), `headshots/${SPEAKER}/photo`), bytes(), jpeg));
    await assertSucceeds(
      uploadBytes(ref(asSpeaker(), `headshots/${SPEAKER}/photo`), bytes(64), jpeg),
    );
  });

  it('refuses one written into somebody else’s folder', async () => {
    // The stored answer is derived from the uid, so this is the move that would
    // let a speaker claim another person's photo as their own answer.
    await assertFails(uploadBytes(ref(asOther(), `headshots/${SPEAKER}/photo`), bytes(), jpeg));
  });

  it('refuses a stranger and an unverified account', async () => {
    await assertFails(uploadBytes(ref(asStranger(), `headshots/${SPEAKER}/photo`), bytes(), jpeg));
    await assertFails(
      uploadBytes(ref(asUnverified(), `headshots/${SPEAKER}/photo`), bytes(), jpeg),
    );
  });
});

describe('what the bucket will accept', () => {
  it('refuses a file that is not an image we render', async () => {
    // The content type is what a browser acts on when an organiser opens it.
    for (const contentType of ['text/html', 'application/pdf', 'image/svg+xml']) {
      await assertFails(
        uploadBytes(ref(asSpeaker(), `headshots/${SPEAKER}/photo`), bytes(), { contentType }),
      );
    }
  });

  it('accepts the three types the form offers', async () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) {
      await assertSucceeds(
        uploadBytes(ref(asSpeaker(), `headshots/${SPEAKER}/photo`), bytes(), { contentType }),
      );
    }
  });

  it('refuses one over the size cap', async () => {
    // Nothing else bounds what an accepted speaker can put in the bucket.
    await assertFails(
      uploadBytes(ref(asSpeaker(), `headshots/${SPEAKER}/photo`), bytes(6 * 1024 * 1024), jpeg),
    );
  });

  it('refuses anything outside the headshots prefix', async () => {
    for (const path of ['loose', 'other/thing', `headshots/${SPEAKER}/nested/deep`]) {
      await assertFails(uploadBytes(ref(asSpeaker(), path), bytes(), jpeg));
    }
  });
});

describe('reading a headshot', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `headshots/${SPEAKER}/photo`), bytes(), jpeg);
    });
  });

  it('lets the owner see their own', async () => {
    await assertSucceeds(getBytes(ref(asSpeaker(), `headshots/${SPEAKER}/photo`)));
  });

  /*
   * Not even a reviewer. Storage rules cannot read Firestore, so there is no way
   * to say "and the committee" here — a rule loose enough to admit one would
   * admit everyone. Organisers go through the admin-only `headshotImage`
   * callable, which returns the bytes after checking the role.
   */
  it('refuses everyone else, including another speaker', async () => {
    await assertFails(getBytes(ref(asOther(), `headshots/${SPEAKER}/photo`)));
    await assertFails(getBytes(ref(asStranger(), `headshots/${SPEAKER}/photo`)));
  });
});
