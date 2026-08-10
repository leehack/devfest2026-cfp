/**
 * One image answer on the confirmation form.
 *
 * Writes go through a verified callable so archive and deletion can fence the
 * bucket mutation. Preview bytes come back through a verified callable too;
 * the browser never receives a bucket URL or creates a download token.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { uploadHeadshot, workingHeadshotImage } from '../lib/proposals';
import { useI18n } from '../i18n/context';
import { FORM_LIMITS, IMAGE_TYPES } from '@shared/confirmForm';

interface Props {
  cfpId: string;
  proposalId: string;
  fieldKey: string;
  label: string;
  help?: string;
  required: boolean;
  error?: string;
  disabled: boolean;
  /** True once the server has told us there is already a file for this key. */
  uploaded: boolean;
  onUploaded: (path: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function HeadshotField({
  cfpId,
  proposalId,
  fieldKey,
  label,
  help,
  required,
  error,
  disabled,
  uploaded,
  onUploaded,
  onBusyChange,
}: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [problem, setProblem] = useState('');
  const previewUrl = useRef('');

  const showPreview = useCallback((blob: Blob | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = blob ? URL.createObjectURL(blob) : '';
    setPreview(previewUrl.current);
  }, []);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  // Shows what is already stored, so someone coming back sees the photo they
  // sent rather than an empty control that reads as "it did not save".
  useEffect(() => {
    if (!uploaded) {
      showPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await workingHeadshotImage({
          cfpId,
          proposalId,
          key: fieldKey,
          working: true,
        });
        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        if (!cancelled) showPreview(new Blob([bytes], { type: data.contentType }));
      } catch {
        /* The answer is recorded either way; a missing preview is cosmetic. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uploaded, cfpId, proposalId, fieldKey, showPreview]);

  async function choose(file: File) {
    // Checked here as well as in the callable, so an unsupported file is
    // explained before base64 encoding and upload consume time and bandwidth.
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setProblem(t.form.imageType);
      return;
    }
    if (file.size > FORM_LIMITS.image) {
      setProblem(t.form.imageTooBig);
      return;
    }

    setProblem('');
    setBusy(true);
    onBusyChange?.(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });
      const separator = dataUrl.indexOf(',');
      if (separator < 0) throw new Error('Could not encode the file.');
      const { data } = await uploadHeadshot({
        cfpId,
        proposalId,
        key: fieldKey,
        contentType: file.type,
        base64: dataUrl.slice(separator + 1),
      });
      showPreview(file);
      onUploaded(data.path);
    } catch {
      setProblem(t.form.imageFailed);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      // Cleared so choosing the same file again still fires a change event.
      if (input.current) input.current.value = '';
    }
  }

  const message = problem || error;

  return (
    <div className={`field${message ? ' field--error' : ''}`}>
      <span className="field__label">
        {label}
        <span className="field__requirement">{required ? t.form.required : t.form.optional}</span>
      </span>
      {help && <p className="field__help">{help}</p>}

      <div className="headshot">
        {preview ? (
          <img className="headshot__preview" src={preview} alt="" />
        ) : (
          <span className="headshot__empty" aria-hidden="true" />
        )}
        <div>
          <button
            type="button"
            className="btn"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            {busy
              ? t.form.imageUploading
              : uploaded || preview
                ? t.form.imageReplace
                : t.form.imageChoose}
          </button>
          <p className="field__help">{t.form.imageHint}</p>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        className="headshot__input"
        accept={IMAGE_TYPES.join(',')}
        aria-label={label}
        aria-invalid={Boolean(message)}
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void choose(file);
        }}
      />

      {message && (
        <p className="field__error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
