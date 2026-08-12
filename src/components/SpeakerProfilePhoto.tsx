import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { FORM_LIMITS, IMAGE_TYPES } from '@shared/confirmForm';

import { useI18n } from '../i18n/context';
import {
  profilePhotoImage,
  removeProfilePhoto,
  uploadProfilePhoto,
} from '../lib/proposals';
import { base64Of, imageBlobFromBase64, imageDimensions } from '../lib/imageFiles';

interface Props {
  required?: boolean;
  disabled?: boolean;
  error?: string;
  onBusyChange?: (busy: boolean) => void;
  onChanged?: (generation: string | null) => void;
  onCurrentGenerationChange?: (generation: string | null) => void;
  onPresenceChange?: (present: boolean) => void;
  sessionGeneration?: string | null;
  onUseForSession?: (generation: string | null) => Promise<boolean>;
}

export function SpeakerProfilePhoto({
  required = false,
  disabled = false,
  error,
  onBusyChange,
  onChanged,
  onCurrentGenerationChange,
  onPresenceChange,
  sessionGeneration,
  onUseForSession,
}: Props) {
  const { t } = useI18n();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const sessionStatus = useRef<HTMLDivElement>(null);
  const previewUrl = useRef('');
  const [preview, setPreview] = useState('');
  const [generation, setGeneration] = useState<string | null>(null);
  const [generationKnown, setGenerationKnown] = useState(false);
  const [present, setPresent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [problem, setProblem] = useState('');
  const [sessionProblem, setSessionProblem] = useState('');
  const loadFailed = useRef(t.profilePhoto.loadFailed);
  const onBusyChangeRef = useRef(onBusyChange);
  const onCurrentGenerationChangeRef = useRef(onCurrentGenerationChange);
  loadFailed.current = t.profilePhoto.loadFailed;
  onBusyChangeRef.current = onBusyChange;
  onCurrentGenerationChangeRef.current = onCurrentGenerationChange;

  const message = problem || error;
  const errorId = message ? `${inputId}-error` : undefined;

  const showPreview = useCallback((blob: Blob | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = blob ? URL.createObjectURL(blob) : '';
    setPreview(previewUrl.current);
  }, []);

  const setPresence = useCallback(
    (next: boolean) => {
      setPresent(next);
      onPresenceChange?.(next);
    },
    [onPresenceChange],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    onBusyChangeRef.current?.(true);
    setGenerationKnown(false);
    void profilePhotoImage({})
      .then(({ data }) => {
        if (cancelled) return;
        showPreview(imageBlobFromBase64(data.base64, data.contentType));
        setGeneration(data.generation);
        setGenerationKnown(true);
        onCurrentGenerationChangeRef.current?.(data.generation);
        setPresence(true);
      })
      .catch((failure) => {
        if (cancelled) return;
        const code = String((failure as { code?: unknown } | null)?.code ?? '').replace(
          /^functions\//,
          '',
        );
        showPreview(null);
        setGeneration(null);
        setGenerationKnown(code === 'not-found');
        onCurrentGenerationChangeRef.current?.(null);
        setPresence(false);
        if (code !== 'not-found') setProblem(loadFailed.current);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          onBusyChangeRef.current?.(false);
        }
      });
    return () => {
      cancelled = true;
      onBusyChangeRef.current?.(false);
    };
  }, [setPresence, showPreview]);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  function setWorking(next: boolean) {
    setBusy(next);
    onBusyChangeRef.current?.(next);
  }

  async function choose(file: File) {
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setProblem(t.form.imageType);
      return;
    }
    if (file.size > FORM_LIMITS.image) {
      setProblem(t.form.imageTooBig);
      return;
    }
    try {
      const dimensions = await imageDimensions(file);
      if (Math.min(dimensions.width, dimensions.height) < FORM_LIMITS.speakerPhotoMinEdge) {
        setProblem(t.profilePhoto.tooSmall(FORM_LIMITS.speakerPhotoMinEdge));
        return;
      }
    } catch {
      setProblem(t.form.imageType);
      return;
    }

    setProblem('');
    setWorking(true);
    try {
      const { data } = await uploadProfilePhoto({
        contentType: file.type,
        base64: await base64Of(file),
      });
      showPreview(file);
      setGeneration(data.generation);
      setGenerationKnown(true);
      onCurrentGenerationChange?.(data.generation);
      setPresence(true);
      setSessionProblem('');
      onChanged?.(data.generation);
    } catch {
      setProblem(t.profilePhoto.uploadFailed);
    } finally {
      setWorking(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    if (!window.confirm(t.profilePhoto.removeConfirm)) return;
    setProblem('');
    setWorking(true);
    try {
      await removeProfilePhoto({});
      showPreview(null);
      setGeneration(null);
      setGenerationKnown(true);
      onCurrentGenerationChange?.(null);
      setPresence(false);
      setSessionProblem('');
      onChanged?.(null);
    } catch {
      setProblem(t.profilePhoto.removeFailed);
    } finally {
      setWorking(false);
    }
  }

  async function approveForSession() {
    if (!onUseForSession || !generationKnown || (required && generation === null)) return;
    setAdopting(true);
    setSessionProblem('');
    try {
      if (await onUseForSession(generation)) {
        requestAnimationFrame(() => sessionStatus.current?.focus({ preventScroll: true }));
      } else {
        setSessionProblem(t.profilePhoto.sessionUpdateFailed);
      }
    } catch {
      setSessionProblem(t.profilePhoto.sessionUpdateFailed);
    } finally {
      setAdopting(false);
    }
  }

  const sessionOutdated = Boolean(
    onUseForSession && generationKnown && generation !== sessionGeneration,
  );
  const sessionCurrent = Boolean(
    onUseForSession && generationKnown && generation === sessionGeneration && generation !== null,
  );
  const sessionEmpty = Boolean(
    onUseForSession && generationKnown && !required && generation === null && sessionGeneration === null,
  );
  const requiredPhotoMissing = Boolean(
    onUseForSession && generationKnown && required && generation === null,
  );
  const canUpdateSession = sessionOutdated && (generation !== null || !required);
  return (
    <section
      className={`speaker-photo${message ? ' field--error' : ''}`}
      aria-busy={loading || busy || adopting}
    >
      <div className="speaker-photo__copy">
        <h3>{t.profilePhoto.title}</h3>
        <span className="field__requirement">
          {required ? t.form.required : t.form.optional}
        </span>
        <p>{t.profilePhoto.help}</p>
      </div>
      <div className="speaker-photo__control">
        {preview ? (
          <img className="speaker-photo__preview" src={preview} alt={t.profilePhoto.previewAlt} />
        ) : (
          <span className="speaker-photo__empty" aria-hidden="true" />
        )}
        <div className="speaker-photo__actions">
          <button
            type="button"
            className="btn"
            disabled={disabled || busy || adopting || loading}
            aria-invalid={Boolean(message)}
            aria-describedby={errorId}
            aria-errormessage={errorId}
            onClick={() => input.current?.click()}
          >
            {busy
              ? t.form.imageUploading
              : present
                ? t.form.imageReplace
                : t.form.imageChoose}
          </button>
          {present && !required && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={disabled || busy || adopting || loading}
              onClick={() => void remove()}
            >
              {t.profilePhoto.remove}
            </button>
          )}
          <p className="field__help">
            {t.profilePhoto.requirements(FORM_LIMITS.speakerPhotoMinEdge)}
          </p>
        </div>
      </div>
      <input
        ref={input}
        className="speaker-photo__input"
        type="file"
        accept={IMAGE_TYPES.join(',')}
        aria-label={t.profilePhoto.chooseLabel}
        aria-invalid={Boolean(message)}
        aria-describedby={errorId}
        aria-errormessage={errorId}
        tabIndex={-1}
        disabled={disabled || busy || loading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
        }}
      />
      {(sessionOutdated || sessionCurrent || sessionEmpty || requiredPhotoMissing) && (
        <div
          ref={sessionStatus}
          className={`speaker-photo__session-status${
            sessionOutdated || requiredPhotoMissing
              ? ' speaker-photo__session-status--update'
              : ''
          }`}
          role="status"
          aria-live="polite"
          tabIndex={-1}
        >
          <div>
            <strong>
              {requiredPhotoMissing
                ? t.profilePhoto.sessionRequiredTitle
                : sessionOutdated
                  ? generation
                    ? t.profilePhoto.sessionUpdateTitle
                    : t.profilePhoto.sessionRemovalTitle
                  : sessionCurrent
                    ? t.profilePhoto.sessionCurrentTitle
                    : t.profilePhoto.sessionEmptyTitle}
            </strong>
            <p>
              {requiredPhotoMissing
                ? t.profilePhoto.sessionRequiredHelp
                : sessionOutdated
                  ? generation
                    ? t.profilePhoto.sessionUpdateHelp
                    : t.profilePhoto.sessionRemovalHelp
                  : sessionCurrent
                    ? t.profilePhoto.sessionCurrentHelp
                    : t.profilePhoto.sessionEmptyHelp}
            </p>
          </div>
          {canUpdateSession && (
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={disabled || busy || adopting || loading}
              onClick={() => void approveForSession()}
            >
              {adopting
                ? t.profilePhoto.sessionUpdating
                : generation
                  ? t.profilePhoto.useForSession
                  : t.profilePhoto.removeFromSession}
            </button>
          )}
          {sessionProblem && (
            <p className="field__error" role="alert">
              {sessionProblem}
            </p>
          )}
        </div>
      )}
      {message && (
        <p className="field__error" id={errorId} role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
