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

import { useState } from 'react';

import { FieldRows } from './FieldRows';
import { useI18n } from '../i18n';
import { adminError } from '../lib/errors';
import { setConfirmForm } from '../lib/roles';
import { keyFromLabel, validateForm, type ConfirmField } from '@shared/confirmForm';

/**
 * Keys are filled in at save rather than as the label is typed: generating on
 * every keystroke would rewrite the key of a field somebody is halfway through
 * renaming, and the key is the one thing that must not move.
 */
export function withKeys(fields: ConfirmField[]): ConfirmField[] {
  const keyed: ConfirmField[] = [];
  for (const field of fields) {
    keyed.push(
      field.key ? field : { ...field, key: keyFromLabel(field.label.en, keyed.map((f) => f.key)) },
    );
  }
  return keyed;
}

export function ConfirmFormEditor({
  cfpId,
  fields: saved,
}: {
  cfpId: string;
  fields: ConfirmField[];
}) {
  const { t } = useI18n();
  const [fields, setFields] = useState<ConfirmField[]>(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  async function save() {
    setNote('');
    setError('');

    const keyed = withKeys(fields);
    const fault = validateForm({ fields: keyed });
    if (fault) {
      setError(t.admin.formErrors[fault.problem].replace('{key}', fault.key || '—'));
      return;
    }

    setBusy(true);
    try {
      const { data } = await setConfirmForm({ cfpId, fields: keyed });
      // The server's normalised copy, not ours — it trims and drops, and the
      // editor should show what was actually stored.
      setFields(data.fields);
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

      <FieldRows
        fields={fields}
        onChange={setFields}
        busy={busy}
        labels={{
          empty: t.admin.formEmpty,
          untitled: t.admin.formUntitled,
          labelEn: t.admin.formLabelEn,
          labelFr: t.admin.formLabelFr,
          add: t.admin.formAdd,
          removeConfirm: t.admin.formRemoveConfirm,
        }}
      />

      <div className="row row--wrap">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>
          {busy ? t.admin.formSaving : t.admin.formSave}
        </button>
      </div>

      {note && <p className="note note--inline">{note}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
