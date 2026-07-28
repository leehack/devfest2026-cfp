/**
 * One image answer on the confirmation form.
 *
 * The file goes straight to Cloud Storage from the browser rather than through
 * a callable: a callable would have to carry the bytes as base64 in a request
 * body, which is both a size limit and a bill for nothing.
 *
 * Nothing about the upload is reported to the server. `respondToDecision` asks
 * the bucket whether an object exists at the one path this speaker could have
 * written to, so there is no claim here for anyone to forge — the worst a
 * tampered client can do is fail to upload its own photo.
 */

import { useEffect, useRef, useState } from 'react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { storage } from '../firebase';
import { useI18n } from '../i18n';
import { FORM_LIMITS, IMAGE_TYPES, headshotPath } from '@shared/confirmForm';

interface Props {
  uid: string;
  fieldKey: string;
  label: string;
  help?: string;
  required: boolean;
  error?: string;
  disabled: boolean;
  /** True once the server has told us there is already a file for this key. */
  uploaded: boolean;
  onUploaded: () => void;
}

export function HeadshotField({
  uid,
  fieldKey,
  label,
  help,
  required,
  error,
  disabled,
  uploaded,
  onUploaded,
}: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [problem, setProblem] = useState('');

  // Shows what is already stored, so someone coming back sees the photo they
  // sent rather than an empty control that reads as "it did not save".
  useEffect(() => {
    if (!uploaded) return;
    let cancelled = false;
    getDownloadURL(ref(storage, headshotPath(uid, fieldKey)))
      .then((url) => {
        if (!cancelled) setPreview(url);
      })
      .catch(() => {
        /* The answer is recorded either way; a missing preview is cosmetic. */
      });
    return () => {
      cancelled = true;
    };
  }, [uploaded, uid, fieldKey]);

  async function choose(file: File) {
    // Checked here as well as in `storage.rules`, because a rule rejection
    // arrives as an opaque failure after the whole file has gone up the wire.
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
    try {
      const target = ref(storage, headshotPath(uid, fieldKey));
      await uploadBytes(target, file, { contentType: file.type });
      setPreview(await getDownloadURL(target));
      onUploaded();
    } catch {
      setProblem(t.form.imageFailed);
    } finally {
      setBusy(false);
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
            {busy ? t.form.imageUploading : preview ? t.form.imageReplace : t.form.imageChoose}
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
