import { FORM_LIMITS, IMAGE_TYPES } from '../../shared/confirmForm';
import {
  customScheduleSpeakerPhotoPath,
  validCustomScheduleSpeakerPhotoRef,
} from './headshots';

export interface CustomScheduleSpeakerPhotoAsset {
  cfpId: string;
  assetRef: string;
  path: string;
  generation: string;
  contentType: (typeof IMAGE_TYPES)[number];
  size: number;
}

/** Validates one callable-owned asset document without trusting its stored path. */
export function customScheduleSpeakerPhotoAssetFrom(
  value: unknown,
  cfpId: string,
  expectedAssetRef: string,
): CustomScheduleSpeakerPhotoAsset | null {
  if (
    !validCustomScheduleSpeakerPhotoRef(expectedAssetRef) ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }
  const asset = value as Partial<CustomScheduleSpeakerPhotoAsset>;
  if (
    asset.cfpId !== cfpId ||
    asset.assetRef !== expectedAssetRef ||
    asset.path !== customScheduleSpeakerPhotoPath(cfpId, expectedAssetRef) ||
    typeof asset.generation !== 'string' ||
    !asset.generation ||
    !(IMAGE_TYPES as readonly unknown[]).includes(asset.contentType) ||
    typeof asset.size !== 'number' ||
    !Number.isFinite(asset.size) ||
    asset.size <= 0 ||
    asset.size > FORM_LIMITS.image
  ) {
    return null;
  }
  return asset as CustomScheduleSpeakerPhotoAsset;
}
