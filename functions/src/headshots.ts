import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import sharp from 'sharp';

import {
  FORM_LIMITS,
  IMAGE_TYPES,
  confirmedHeadshotPath,
  headshotPath,
  isWorkingHeadshotPath,
  type ConfirmForm,
  type HeadshotUploads,
} from '../../shared/confirmForm';

type Bucket = ReturnType<Storage['bucket']>;

export interface UploadedHeadshot {
  path: string;
  generation: string;
}

export interface StoredHeadshot extends UploadedHeadshot {
  bytes: Buffer;
  contentType: (typeof IMAGE_TYPES)[number];
}

export interface HeadshotUploadPayload {
  bytes: Buffer;
  contentType: (typeof IMAGE_TYPES)[number];
}

/** New participant-scoped objects; the proposal-only helpers remain the legacy format. */
export function speakerWorkingHeadshotPrefix(
  cfpId: string,
  proposalId: string,
  uid: string,
  key: string,
): string {
  return `cfps/${cfpId}/workingHeadshots/${proposalId}/${encodeURIComponent(uid)}/${key}/`;
}

export function speakerWorkingHeadshotPath(
  cfpId: string,
  proposalId: string,
  uid: string,
  key: string,
  uploadId: string,
): string {
  return `${speakerWorkingHeadshotPrefix(cfpId, proposalId, uid, key)}${encodeURIComponent(uploadId)}`;
}

export function isSpeakerWorkingHeadshotPath(
  path: string,
  cfpId: string,
  proposalId: string,
  uid: string,
  key: string,
): boolean {
  const prefix = speakerWorkingHeadshotPrefix(cfpId, proposalId, uid, key);
  const uploadId = path.slice(prefix.length);
  return path.startsWith(prefix) && uploadId.length > 0 && !uploadId.includes('/');
}

export function speakerConfirmedHeadshotPrefix(
  cfpId: string,
  proposalId: string,
  uid: string,
  key: string,
): string {
  return `cfps/${cfpId}/confirmedHeadshots/${proposalId}/${encodeURIComponent(uid)}/${key}/`;
}

export function speakerConfirmedHeadshotPath(
  cfpId: string,
  proposalId: string,
  uid: string,
  key: string,
  generation: string,
): string {
  return `${speakerConfirmedHeadshotPrefix(cfpId, proposalId, uid, key)}${encodeURIComponent(generation)}`;
}

export function isSpeakerConfirmedHeadshotPath(
  path: string,
  cfpId: string,
  proposalId: string,
  uid: string,
  key: string,
): boolean {
  const prefix = speakerConfirmedHeadshotPrefix(cfpId, proposalId, uid, key);
  const generation = path.slice(prefix.length);
  return path.startsWith(prefix) && generation.length > 0 && !generation.includes('/');
}

const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 16_000_000;
const SHARP_FORMAT: Record<(typeof IMAGE_TYPES)[number], string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function hasCompleteContainer(
  bytes: Uint8Array,
  contentType: (typeof IMAGE_TYPES)[number],
): boolean {
  if (contentType === 'image/jpeg') {
    return bytes.length >= 4 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (contentType === 'image/png') {
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    return bytes.length >= 45 && iend.every((value, index) => bytes[bytes.length - 12 + index] === value);
  }
  if (bytes.length < 30) return false;
  const declaredLength =
    bytes[4] + bytes[5] * 0x100 + bytes[6] * 0x1_0000 + bytes[7] * 0x1_000000 + 8;
  return declaredLength === bytes.length;
}

/** Fully decodes one static raster before it can satisfy an image answer. */
export async function imageBytesMatchContentType(
  bytes: Uint8Array,
  contentType: unknown,
): Promise<boolean> {
  if (!(IMAGE_TYPES as readonly unknown[]).includes(contentType)) return false;
  const expectedType = contentType as (typeof IMAGE_TYPES)[number];
  if (!hasCompleteContainer(bytes, expectedType)) return false;
  try {
    const image = sharp(bytes, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      metadata.format !== SHARP_FORMAT[expectedType] ||
      (metadata.pages ?? 1) !== 1 ||
      width < 1 ||
      height < 1 ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION ||
      width * height > MAX_IMAGE_PIXELS
    ) {
      return false;
    }

    // Metadata parsing alone accepts a valid header with corrupt compressed
    // pixels. A raw output forces libvips to consume the complete raster.
    const decoded = await image.raw().toBuffer({ resolveWithObject: true });
    const samples = width * height * decoded.info.channels;
    const bytesPerSample = decoded.data.length / samples;
    return (
      decoded.info.width === width &&
      decoded.info.height === height &&
      decoded.info.channels > 0 &&
      [1, 2, 4, 8, 16].includes(bytesPerSample)
    );
  } catch {
    return false;
  }
}

/** Strictly decodes the JSON-safe payload accepted by `uploadHeadshot`. */
export async function decodeHeadshotUpload(
  contentType: unknown,
  base64: unknown,
): Promise<HeadshotUploadPayload> {
  if (!(IMAGE_TYPES as readonly unknown[]).includes(contentType)) {
    throw new HttpsError('invalid-argument', 'Choose a JPEG, PNG or WebP image.');
  }
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new HttpsError('invalid-argument', 'The image data is required.');
  }

  // Refuse oversized JSON before allocating its decoded buffer. FileReader
  // emits canonical padded base64, which also gives us one exact encoding to
  // validate instead of relying on Node's deliberately permissive decoder.
  const maxEncodedLength = Math.ceil(FORM_LIMITS.image / 3) * 4;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const encodedBytes = padding > 0 ? base64.slice(0, -padding) : base64;
  if (
    base64.length > maxEncodedLength ||
    base64.length % 4 !== 0 ||
    /[^A-Za-z0-9+/]/.test(encodedBytes)
  ) {
    throw new HttpsError('invalid-argument', 'The image data is invalid or too large.');
  }

  const bytes = Buffer.from(base64, 'base64');
  if (
    bytes.length === 0 ||
    bytes.length > FORM_LIMITS.image ||
    bytes.toString('base64') !== base64
  ) {
    throw new HttpsError('invalid-argument', 'The image data is invalid or too large.');
  }
  if (!(await imageBytesMatchContentType(bytes, contentType))) {
    throw new HttpsError('invalid-argument', 'The file does not match its image type.');
  }

  return {
    bytes,
    contentType: contentType as HeadshotUploadPayload['contentType'],
  };
}

function errorCode(error: unknown): number {
  return Number((error as { code?: unknown } | null)?.code ?? 0);
}

/** Reads and validates the exact object that may satisfy an image answer. */
export async function readStoredHeadshot(
  bucket: Bucket,
  path: string,
  generation?: string,
): Promise<StoredHeadshot | null> {
  try {
    const file = generation
      ? bucket.file(path, { generation })
      : bucket.file(path);
    const [metadata] = await file.getMetadata();
    const storedGeneration = String(metadata.generation ?? '');
    const contentType = String(metadata.contentType ?? '');
    const size = Number(metadata.size ?? 0);
    if (!storedGeneration) {
      throw new HttpsError('failed-precondition', 'The uploaded photo has no stable version.');
    }
    if (
      !(IMAGE_TYPES as readonly string[]).includes(contentType) ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > FORM_LIMITS.image
    ) {
      throw new HttpsError('failed-precondition', 'That file is not a supported image.');
    }
    const [bytes] = await file.download();
    if (
      bytes.length !== size ||
      !(await imageBytesMatchContentType(bytes, contentType))
    ) {
      throw new HttpsError('failed-precondition', 'That file is not a supported image.');
    }
    return {
      path,
      generation: storedGeneration,
      bytes,
      contentType: contentType as StoredHeadshot['contentType'],
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (errorCode(error) === 404) return null;
    throw new HttpsError('unavailable', 'The uploaded photo could not be checked. Try again.');
  }
}

async function uploadedHeadshot(
  bucket: Bucket,
  path: string,
): Promise<UploadedHeadshot | null> {
  const stored = await readStoredHeadshot(bucket, path);
  return stored ? { path: stored.path, generation: stored.generation } : null;
}

/** A server-written proposal pointer, or null when the row predates pointers. */
export function workingHeadshotFrom(
  uploads: unknown,
  cfpId: string,
  proposalId: string,
  key: string,
): UploadedHeadshot | null {
  if (!uploads || typeof uploads !== 'object' || Array.isArray(uploads)) return null;
  const pointer = (uploads as Partial<HeadshotUploads>)[key];
  if (
    !pointer ||
    typeof pointer.path !== 'string' ||
    typeof pointer.generation !== 'string' ||
    !pointer.generation ||
    !isWorkingHeadshotPath(pointer.path, cfpId, proposalId, key)
  ) {
    return null;
  }
  return { path: pointer.path, generation: pointer.generation };
}

export function workingHeadshotMatches(
  uploads: unknown,
  cfpId: string,
  proposalId: string,
  key: string,
  expected: UploadedHeadshot,
): boolean {
  const current = workingHeadshotFrom(uploads, cfpId, proposalId, key);
  return current?.path === expected.path && current.generation === expected.generation;
}

/** A server-written pointer in one speaker's private confirmation document. */
export function speakerWorkingHeadshotFrom(
  uploads: unknown,
  cfpId: string,
  proposalId: string,
  uid: string,
  key: string,
): UploadedHeadshot | null {
  if (!uploads || typeof uploads !== 'object' || Array.isArray(uploads)) return null;
  const pointer = (uploads as Partial<HeadshotUploads>)[key];
  if (
    !pointer ||
    typeof pointer.path !== 'string' ||
    typeof pointer.generation !== 'string' ||
    !pointer.generation ||
    !isSpeakerWorkingHeadshotPath(pointer.path, cfpId, proposalId, uid, key)
  ) {
    return null;
  }
  return { path: pointer.path, generation: pointer.generation };
}

export function speakerWorkingHeadshotMatches(
  uploads: unknown,
  cfpId: string,
  proposalId: string,
  uid: string,
  key: string,
  expected: UploadedHeadshot,
): boolean {
  const current = speakerWorkingHeadshotFrom(uploads, cfpId, proposalId, uid, key);
  return current?.path === expected.path && current.generation === expected.generation;
}

/** The current working uploads, with the pre-pointer canonical path as fallback. */
export async function findUploadedHeadshots(
  bucket: Bucket,
  cfpId: string,
  proposalId: string,
  form: ConfirmForm,
  uid: string,
  pointers: unknown,
): Promise<Record<string, UploadedHeadshot>> {
  const images = (form.fields ?? []).filter((field) => field.type === 'image');
  const found: Record<string, UploadedHeadshot> = {};

  await Promise.all(
    images.map(async (field) => {
      const pointer = workingHeadshotFrom(pointers, cfpId, proposalId, field.key);
      if (pointer) {
        const upload = await uploadedHeadshot(bucket, pointer.path);
        if (upload?.generation === pointer.generation) found[field.key] = pointer;
        return;
      }
      if (
        pointers &&
        typeof pointers === 'object' &&
        !Array.isArray(pointers) &&
        Object.prototype.hasOwnProperty.call(pointers, field.key)
      ) {
        throw new HttpsError('failed-precondition', 'The saved photo pointer is invalid.');
      }
      const legacy = await uploadedHeadshot(bucket, headshotPath(cfpId, uid, field.key));
      if (legacy) found[field.key] = legacy;
    }),
  );
  return found;
}

/** Current uploads for one linked speaker. There is no cross-speaker fallback. */
export async function findSpeakerUploadedHeadshots(
  bucket: Bucket,
  cfpId: string,
  proposalId: string,
  form: ConfirmForm,
  uid: string,
  pointers: unknown,
): Promise<Record<string, UploadedHeadshot>> {
  const images = (form.fields ?? []).filter((field) => field.type === 'image');
  const found: Record<string, UploadedHeadshot> = {};

  await Promise.all(
    images.map(async (field) => {
      const pointer = speakerWorkingHeadshotFrom(
        pointers,
        cfpId,
        proposalId,
        uid,
        field.key,
      );
      if (pointer) {
        const upload = await uploadedHeadshot(bucket, pointer.path);
        if (upload?.generation === pointer.generation) found[field.key] = pointer;
        return;
      }
      if (
        pointers &&
        typeof pointers === 'object' &&
        !Array.isArray(pointers) &&
        Object.prototype.hasOwnProperty.call(pointers, field.key)
      ) {
        throw new HttpsError('failed-precondition', 'The saved photo pointer is invalid.');
      }
    }),
  );
  return found;
}

/**
 * Copies one version to a path browser rules never open. The source handle is
 * pinned to its generation, so a replacement racing the copy fails instead of
 * silently becoming the answer that was confirmed.
 */
export async function freezeHeadshot(
  bucket: Bucket,
  cfpId: string,
  proposalId: string,
  key: string,
  upload: UploadedHeadshot,
): Promise<string> {
  const frozenPath = confirmedHeadshotPath(cfpId, proposalId, key, upload.generation);
  try {
    await bucket.file(upload.path, { generation: upload.generation }).copy(frozenPath);
  } catch {
    throw new HttpsError(
      'failed-precondition',
      'The uploaded photo changed while it was being confirmed. Try again.',
    );
  }
  return frozenPath;
}

export async function freezeUploadedHeadshots(
  bucket: Bucket,
  cfpId: string,
  proposalId: string,
  uploads: Record<string, UploadedHeadshot>,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(uploads).map(async ([key, upload]) => [
        key,
        await freezeHeadshot(bucket, cfpId, proposalId, key, upload),
      ]),
    ),
  );
}

export async function freezeSpeakerUploadedHeadshots(
  bucket: Bucket,
  cfpId: string,
  proposalId: string,
  uid: string,
  uploads: Record<string, UploadedHeadshot>,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(uploads).map(async ([key, upload]) => {
        const frozenPath = speakerConfirmedHeadshotPath(
          cfpId,
          proposalId,
          uid,
          key,
          upload.generation,
        );
        try {
          await bucket.file(upload.path, { generation: upload.generation }).copy(frozenPath);
        } catch {
          throw new HttpsError(
            'failed-precondition',
            'The uploaded photo changed while it was being confirmed. Try again.',
          );
        }
        return [key, frozenPath];
      }),
    ),
  );
}

function legacyHeadshot(
  value: unknown,
  cfpId: string,
  speakerIds: unknown,
  key: string,
): value is string {
  return (
    typeof value === 'string' &&
    Array.isArray(speakerIds) &&
    speakerIds.some((uid) =>
      typeof uid === 'string' ? value === headshotPath(cfpId, uid, key) : false,
    )
  );
}

/** Freezes one still-current legacy answer and returns its durable path. */
export async function freezeLegacyHeadshotAnswer(
  db: Firestore,
  bucket: Bucket,
  cfpId: string,
  proposalRef: DocumentReference,
  key: string,
  livePath: string,
): Promise<string> {
  const upload = await uploadedHeadshot(bucket, livePath);
  if (!upload) {
    throw new HttpsError(
      'failed-precondition',
      'A confirmed photo is missing. Restore it before archiving this call.',
    );
  }
  const frozenPath = await freezeHeadshot(
    bucket,
    cfpId,
    proposalRef.id,
    key,
    upload,
  );

  return db.runTransaction(async (tx) => {
    const current = await tx.get(proposalRef);
    if (!current.exists) throw new HttpsError('not-found', 'No such proposal.');
    const currentAnswers = current.get('confirmAnswers');
    if (!currentAnswers || typeof currentAnswers !== 'object' || Array.isArray(currentAnswers)) {
      throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
    }
    const currentPath = (currentAnswers as Record<string, unknown>)[key];
    if (currentPath !== livePath) {
      if (typeof currentPath !== 'string') {
        throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
      }
      return currentPath;
    }
    tx.update(proposalRef, {
      confirmAnswers: {
        ...(currentAnswers as Record<string, unknown>),
        [key]: frozenPath,
      },
    });
    return frozenPath;
  });
}

/**
 * Upgrades pre-snapshot confirmation answers before an event becomes
 * read-only. Each answer moves monotonically from its live path to one frozen
 * generation. A partial failure is safe to retry; archive does not proceed.
 */
export async function freezeLegacyHeadshots(
  db: Firestore,
  bucket: Bucket,
  cfpId: string,
): Promise<void> {
  const proposals = await db.collection(`cfps/${cfpId}/proposals`).get();

  for (const proposal of proposals.docs) {
    const answers = proposal.get('confirmAnswers');
    const speakerIds = proposal.get('speakerIds');
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) continue;

    for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
      if (!legacyHeadshot(value, cfpId, speakerIds, key)) continue;
      await freezeLegacyHeadshotAnswer(db, bucket, cfpId, proposal.ref, key, value);
    }
  }
}
