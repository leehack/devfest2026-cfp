/**
 * Cloud Storage rules. Runs under `npm run test:rules`.
 *
 * The bucket holds photographs of people's faces, collected once they are on
 * the programme. Browser writes stay closed because only a callable can hold
 * the same external-mutation lease as archive and deletion. Preview bytes also
 * come from a verified callable, so no browser gets a bucket read surface.
 */

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'demo-devfest-cfp';
const CFP_ID = 'devfest-mtl-2026';
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

describe('working headshot writes', () => {
  it('refuses every browser upload, including a valid image from its owner', async () => {
    const own = `cfps/${CFP_ID}/headshots/${SPEAKER}/photo`;
    for (const client of [asSpeaker(), asOther(), asUnverified(), asStranger()]) {
      await assertFails(uploadBytes(ref(client, own), bytes(), jpeg));
    }
  });

  it('refuses browser replacement and deletion too', async () => {
    const own = `cfps/${CFP_ID}/headshots/${SPEAKER}/photo`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), own), bytes(), jpeg);
    });
    await assertFails(uploadBytes(ref(asSpeaker(), own), bytes(64), jpeg));
    await assertFails(deleteObject(ref(asSpeaker(), own)));
  });

  it('does not accidentally open another content type, tenant or owner path', async () => {
    for (const [path, contentType] of [
      [`cfps/${CFP_ID}/headshots/${SPEAKER}/photo`, 'image/png'],
      [`cfps/someone-elses-conf/headshots/${SPEAKER}/photo`, 'image/webp'],
      [`cfps/${CFP_ID}/headshots/${OTHER}/photo`, 'image/jpeg'],
      [`cfps/${CFP_ID}/headshots/${SPEAKER}/photo`, 'text/html'],
      [`cfps/${CFP_ID}/workingHeadshots/proposal/photo/upload-id`, 'image/png'],
    ]) {
      await assertFails(uploadBytes(ref(asSpeaker(), path), bytes(), { contentType }));
    }
  });

  it('refuses anything outside the headshots prefix', async () => {
    for (const path of [
      'loose',
      'other/thing',
      `cfps/${CFP_ID}/headshots/${SPEAKER}/nested/deep`,
      // The old, untenanted path. Nothing writes here any more, and a rule that
      // still accepted it would be a second door into the same bucket.
      `headshots/${SPEAKER}/photo`,
    ]) {
      await assertFails(uploadBytes(ref(asSpeaker(), path), bytes(), jpeg));
    }
  });
});

describe('reading a working headshot', () => {
  const working = `cfps/${CFP_ID}/workingHeadshots/proposal/photo/upload-id`;

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), working), bytes(), jpeg);
    });
  });

  it('refuses every browser, including the speaker whose photo it is', async () => {
    for (const client of [asSpeaker(), asOther(), asUnverified(), asStranger()]) {
      await assertFails(getBytes(ref(client, working)));
    }
  });
});

describe('a confirmed headshot snapshot', () => {
  const frozen = `cfps/${CFP_ID}/confirmedHeadshots/proposal-1/photo/12345`;

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), frozen), bytes(), jpeg);
    });
  });

  it('cannot be read, replaced or deleted through a speaker client', async () => {
    await assertFails(getBytes(ref(asSpeaker(), frozen)));
    await assertFails(uploadBytes(ref(asSpeaker(), frozen), bytes(64), jpeg));
    await assertFails(deleteObject(ref(asSpeaker(), frozen)));
  });
});
