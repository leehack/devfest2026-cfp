import { describe, expect, it } from 'vitest';

import { customScheduleSpeakerPhotoAssetFrom } from '../functions/src/customSchedulePhotos';
import { customScheduleSpeakerPhotoPath } from '../functions/src/headshots';

const CFP_ID = 'devfest-mtl-2026';
const ASSET_REF = 'a'.repeat(43);

describe('custom schedule speaker photo assets', () => {
  it('accepts only an exact callable-owned event asset', () => {
    const asset = {
      cfpId: CFP_ID,
      assetRef: ASSET_REF,
      path: customScheduleSpeakerPhotoPath(CFP_ID, ASSET_REF),
      generation: '123',
      contentType: 'image/png',
      size: 1234,
    };

    expect(customScheduleSpeakerPhotoAssetFrom(asset, CFP_ID, ASSET_REF)).toEqual(asset);
    expect(customScheduleSpeakerPhotoAssetFrom(asset, 'another-cfp', ASSET_REF)).toBeNull();
    expect(customScheduleSpeakerPhotoAssetFrom({ ...asset, path: 'speakerProfilePhotos/u/x' }, CFP_ID, ASSET_REF)).toBeNull();
    expect(customScheduleSpeakerPhotoAssetFrom({ ...asset, generation: '' }, CFP_ID, ASSET_REF)).toBeNull();
    expect(customScheduleSpeakerPhotoAssetFrom(asset, CFP_ID, 'not-an-asset')).toBeNull();
  });
});
