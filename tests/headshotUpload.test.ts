import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  decodeHeadshotUpload,
  workingHeadshotMatches,
} from '../functions/src/headshots';
import { FORM_LIMITS, workingHeadshotPath } from '../shared/confirmForm';

const valid = {
  'image/jpeg': Buffer.from(
    '/9j//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAAQABAwESAAISAAMSAP/aAAwDAQACEQMRAD8AixJjfx//2Q==',
    'base64',
  ),
  'image/png': readFileSync('tests/fixtures/headshot.png'),
  'image/webp': Buffer.from(
    'UklGRlgAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAf1ZQOCAwAAAA0AEAnQEqAQABAAIANCWgAnS6AfgAA7AA/vDEC/8guWF1yNf/ID/kB/yA//jyAAAA',
    'base64',
  ),
} as const;

const signatures = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': Buffer.from([
    0x52, 0x49, 0x46, 0x46,
    0x00, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
  ]),
} as const;

async function decodeFault(contentType: unknown, base64: unknown): Promise<unknown> {
  try {
    await decodeHeadshotUpload(contentType, base64);
    return null;
  } catch (error) {
    return error;
  }
}

describe('headshot upload payload', () => {
  it('accepts canonical base64 for each supported image content type', async () => {
    for (const [contentType, bytes] of Object.entries(valid)) {
      const base64 = bytes.toString('base64');
      await expect(decodeHeadshotUpload(contentType, base64)).resolves.toEqual({
        bytes,
        contentType,
      });
    }
  });

  it('refuses unsupported content types and malformed encodings', async () => {
    for (const [contentType, base64] of [
      ['image/svg+xml', Buffer.from('<svg>').toString('base64')],
      ['text/html', Buffer.from('<script>').toString('base64')],
      ['image/png', 'not base64'],
      ['image/png', ''],
      ['image/png', 'YQ'],
      ['image/png', 'data:image/png;base64,eA=='],
      ['image/png', valid['image/jpeg'].toString('base64')],
      ['image/jpeg', valid['image/webp'].toString('base64')],
    ]) {
      await expect(decodeFault(contentType, base64)).resolves.toMatchObject({
        code: 'invalid-argument',
      });
    }
  });

  it('refuses a signature without a complete decodable image container', async () => {
    for (const [contentType, bytes] of Object.entries(signatures)) {
      await expect(decodeFault(contentType, bytes.toString('base64'))).resolves.toMatchObject({
        code: 'invalid-argument',
      });
    }
  });

  it('refuses a truncated otherwise-valid image', async () => {
    for (const [contentType, bytes] of Object.entries(valid)) {
      await expect(
        decodeFault(contentType, bytes.subarray(0, -2).toString('base64')),
      ).resolves.toMatchObject({ code: 'invalid-argument' });
    }
  });

  it('refuses corrupt compressed pixels inside a complete container', async () => {
    const corrupt = Buffer.from(valid['image/png']);
    corrupt.fill(0, 41, 54);
    await expect(decodeFault('image/png', corrupt.toString('base64'))).resolves.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('refuses images whose dimensions or pixel count exceed the headshot bounds', async () => {
    const tooWide = await sharp({
      create: { width: 8_193, height: 1, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    const tooManyPixels = await sharp({
      create: { width: 4_001, height: 4_000, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    await expect(decodeFault('image/png', tooWide.toString('base64'))).resolves.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(
      decodeFault('image/png', tooManyPixels.toString('base64')),
    ).resolves.toMatchObject({ code: 'invalid-argument' });
  });

  it('accepts the exact byte cap and refuses one byte more', async () => {
    const atCapBytes = Buffer.alloc(FORM_LIMITS.image);
    valid['image/jpeg'].subarray(0, -2).copy(atCapBytes);
    valid['image/jpeg'].subarray(-2).copy(atCapBytes, atCapBytes.length - 2);
    const overCapBytes = Buffer.alloc(FORM_LIMITS.image + 1);
    valid['image/jpeg'].subarray(0, -2).copy(overCapBytes);
    valid['image/jpeg'].subarray(-2).copy(overCapBytes, overCapBytes.length - 2);
    const atCap = atCapBytes.toString('base64');
    const overCap = overCapBytes.toString('base64');

    await expect(decodeHeadshotUpload('image/jpeg', atCap)).resolves.toMatchObject({
      bytes: { length: FORM_LIMITS.image },
    });
    await expect(decodeFault('image/jpeg', overCap)).resolves.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('working headshot pointer recovery', () => {
  const path = workingHeadshotPath('my-cfp', 'proposal-1', 'photo', 'upload-1');
  const expected = { path, generation: '123' };

  it('recognises only the exact current path and generation', () => {
    const uploads = {
      photo: { ...expected, contentType: 'image/png', size: 8 },
    };
    expect(workingHeadshotMatches(uploads, 'my-cfp', 'proposal-1', 'photo', expected)).toBe(true);
    expect(
      workingHeadshotMatches(uploads, 'my-cfp', 'proposal-1', 'photo', {
        ...expected,
        generation: '124',
      }),
    ).toBe(false);
    expect(workingHeadshotMatches(uploads, 'other-cfp', 'proposal-1', 'photo', expected)).toBe(false);
  });
});
