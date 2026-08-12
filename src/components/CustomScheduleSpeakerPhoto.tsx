import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { FORM_LIMITS, IMAGE_TYPES } from '@shared/confirmForm';

import { useI18n } from '../i18n/context';
import { base64Of, imageBlobFromBase64, imageDimensions } from '../lib/imageFiles';
import {
  customScheduleSpeakerPhotoImage,
  uploadCustomScheduleSpeakerPhoto,
} from '../lib/schedule';

interface Props {
  cfpId: string;
  speakerNumber: number;
  photoAssetRef?: string;
  disabled?: boolean;
  onChange: (assetRef: string | undefined) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function CustomScheduleSpeakerPhoto({
  cfpId,
  speakerNumber,
  photoAssetRef,
  disabled = false,
  onChange,
  onBusyChange,
}: Props) {
  const { t } = useI18n();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const previewUrl = useRef('');
  const pendingAssetRef = useRef<string | null | undefined>(undefined);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(Boolean(photoAssetRef));
  const [uploading, setUploading] = useState(false);
  const [changed, setChanged] = useState(false);
  const [problem, setProblem] = useState('');
  const loadFailed = useRef(t.schedule.customSpeakerPhotoLoadFailed);
  loadFailed.current = t.schedule.customSpeakerPhotoLoadFailed;

  const showPreview = useCallback((blob: Blob | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = blob ? URL.createObjectURL(blob) : '';
    setPreview(previewUrl.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const normalisedAssetRef = photoAssetRef ?? null;
    if (pendingAssetRef.current !== undefined) {
      if (pendingAssetRef.current === normalisedAssetRef) {
        setLoading(false);
        return () => {
          cancelled = true;
        };
      }
      pendingAssetRef.current = undefined;
    }
    setChanged(false);
    setProblem('');
    if (!photoAssetRef) {
      setLoading(false);
      showPreview(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    void customScheduleSpeakerPhotoImage({ cfpId, assetRef: photoAssetRef })
      .then(({ data }) => {
        if (!cancelled) showPreview(imageBlobFromBase64(data.base64, data.contentType));
      })
      .catch(() => {
        if (!cancelled) {
          showPreview(null);
          setProblem(loadFailed.current);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cfpId, photoAssetRef, showPreview]);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  async function choose(file: File) {
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setProblem(t.form.imageType);
      return;
    }
    if (file.size > FORM_LIMITS.image) {
      setProblem(t.form.imageTooBig);
      return;
    }
    setProblem('');
    setUploading(true);
    onBusyChange?.(true);
    try {
      let dimensions: { width: number; height: number };
      try {
        dimensions = await imageDimensions(file);
      } catch {
        setProblem(t.form.imageType);
        return;
      }
      if (Math.min(dimensions.width, dimensions.height) < FORM_LIMITS.speakerPhotoMinEdge) {
        setProblem(t.profilePhoto.tooSmall(FORM_LIMITS.speakerPhotoMinEdge));
        return;
      }
      const { data } = await uploadCustomScheduleSpeakerPhoto({
        cfpId,
        contentType: file.type,
        base64: await base64Of(file),
      });
      showPreview(file);
      pendingAssetRef.current = data.assetRef;
      setChanged(true);
      onChange(data.assetRef);
    } catch {
      setProblem(t.schedule.customSpeakerPhotoUploadFailed);
    } finally {
      setUploading(false);
      onBusyChange?.(false);
      if (input.current) input.current.value = '';
    }
  }

  function remove() {
    if (!window.confirm(t.schedule.customSpeakerPhotoRemoveConfirm)) return;
    showPreview(null);
    pendingAssetRef.current = null;
    setChanged(true);
    setProblem('');
    onChange(undefined);
  }

  const busy = loading || uploading;
  const problemId = problem ? `${inputId}-error` : undefined;
  return (
    <section className="schedule-custom-speaker-photo" aria-busy={busy}>
      <div className="schedule-custom-speaker-photo__visual" aria-hidden="true">
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <span>{speakerNumber}</span>
        )}
      </div>
      <div className="schedule-custom-speaker-photo__body">
        <div>
          <strong>{t.schedule.customSpeakerPhoto}</strong>
          <span className="field__requirement">{t.form.optional}</span>
        </div>
        <p>{t.schedule.customSpeakerPhotoHelp}</p>
        <div className="schedule-custom-speaker-photo__actions">
          <button
            type="button"
            className="btn btn--compact"
            disabled={disabled || busy}
            aria-invalid={Boolean(problem)}
            aria-describedby={problemId}
            onClick={() => input.current?.click()}
          >
            {uploading
              ? t.schedule.customSpeakerPhotoUploading
              : preview
                ? t.schedule.customSpeakerPhotoReplace
                : t.schedule.customSpeakerPhotoChoose}
          </button>
          <input
            id={inputId}
            ref={input}
            className="visually-hidden"
            type="file"
            accept={IMAGE_TYPES.join(',')}
            disabled={disabled || busy}
            aria-label={t.schedule.customSpeakerPhotoInput(speakerNumber)}
            aria-invalid={Boolean(problem)}
            aria-describedby={problemId}
            aria-errormessage={problemId}
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void choose(file);
            }}
          />
          {photoAssetRef && (
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              disabled={disabled || busy}
              onClick={remove}
            >
              {t.schedule.customSpeakerPhotoRemove}
            </button>
          )}
        </div>
        {changed && <p className="field__help" role="status">{t.schedule.customSpeakerPhotoPending}</p>}
        {problem && <p className="field__error" id={problemId} role="alert">{problem}</p>}
      </div>
    </section>
  );
}
