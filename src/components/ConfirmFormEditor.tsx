/**
 * The questions an organiser asks a speaker who has just said yes.
 *
 * Editing happens against a local copy and is saved in one go, because the form
 * is one document: a per-field save would be a read-modify-write of the whole
 * list anyway, and doing it here keeps the merge somewhere the admin can see.
 *
 * The rows themselves are `FieldRows`, shared with the submission form's own
 * questions — same shape, same validator, so the same editor.
 */

import { useEffect, useMemo, useState } from 'react';

import { FieldRows, normaliseOptionLines } from './FieldRows';
import { Checkbox } from './fields';
import { useI18n } from '../i18n/context';
import { adminError } from '../lib/errors';
import { invalidateCache } from '../lib/cache';
import { setConfirmForm } from '../lib/roles';
import {
  keyFromLabel,
  validateForm,
  type ConfirmField,
  type ConfirmForm,
} from '@shared/confirmForm';

/**
 * Keys are filled in at save rather than as the label is typed: generating on
 * every keystroke would rewrite the key of a field somebody is halfway through
 * renaming, and the key is the one thing that must not move.
 */
export function withKeys(fields: ConfirmField[]): ConfirmField[] {
  const keyed: ConfirmField[] = [];
  for (const field of fields) {
    const prepared =
      field.type === 'select'
        ? {
            ...field,
            options: normaliseOptionLines(field.options),
          }
        : field;
    keyed.push(
      prepared.key
        ? prepared
        : {
            ...prepared,
            key: keyFromLabel(prepared.label.en, keyed.map((candidate) => candidate.key)),
          },
    );
  }
  return keyed;
}

export function ConfirmFormEditor({
  cfpId,
  form: saved,
  readOnly = false,
  onDirtyChange,
}: {
  cfpId: string;
  form: ConfirmForm;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<ConfirmForm>(saved);
  const [stored, setStored] = useState<ConfirmForm>(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const dirty = useMemo(
    () => !readOnly && JSON.stringify(form) !== JSON.stringify(stored),
    [form, readOnly, stored],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  async function save() {
    if (readOnly) return;
    setNote('');
    setError('');

    const nextForm = { ...form, fields: withKeys(form.fields) };
    const fault = validateForm(nextForm);
    if (fault) {
      setError(t.admin.formErrors[fault.problem].replace('{key}', fault.key || '—'));
      return;
    }

    setBusy(true);
    try {
      const { data } = await setConfirmForm({ cfpId, ...nextForm });
      // The server's normalised copy, not ours — it trims and drops, and the
      // editor should show what was actually stored.
      const savedForm = {
        fields: data.fields,
        speakerPhoto: { required: data.speakerPhoto?.required === true },
      };
      setForm(savedForm);
      setStored(savedForm);
      invalidateCache(`confirmForm:${cfpId}`);
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      setNote(t.admin.formSaved);
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="field__help">{t.admin.formHelp}</p>

      <fieldset className="formfield confirmation-photo-setting">
        <legend>{t.admin.speakerPhotoTitle}</legend>
        <p className="field__help">{t.admin.speakerPhotoHelp}</p>
        <Checkbox
          label={t.admin.speakerPhotoRequired}
          checked={form.speakerPhoto?.required === true}
          onChange={(required) =>
            setForm((current) => ({ ...current, speakerPhoto: { required } }))
          }
          disabled={busy || readOnly}
        />
      </fieldset>

      <FieldRows
        fields={form.fields}
        onChange={(fields) => setForm((current) => ({ ...current, fields }))}
        busy={busy || readOnly}
        labels={{
          empty: t.admin.formEmpty,
          untitled: t.admin.formUntitled,
          labelEn: t.admin.formLabelEn,
          labelFr: t.admin.formLabelFr,
          add: t.admin.formAdd,
          removeConfirm: t.admin.formRemoveConfirm,
        }}
      />

      <div className="row row--wrap form-actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || readOnly || !dirty}
          onClick={save}
        >
          {busy ? t.admin.formSaving : t.admin.formSave}
        </button>
        {dirty && <span className="muted">{t.admin.unsaved}</span>}
      </div>

      <div
        className={note ? 'note note--inline' : undefined}
        role="status"
        aria-atomic="true"
      >
        {note}
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
