/**
 * The questions an organiser asks a speaker who has just said yes.
 *
 * Editing happens against a local copy and is saved in one go, because the form
 * is one document: a per-field save would be a read-modify-write of the whole
 * list anyway, and doing it here keeps the merge somewhere the admin can see.
 *
 * The key is generated once from the English label and then shown read-only.
 * It is what every stored answer is filed under, so renaming it would orphan
 * the answers already collected — a data loss with no warning attached to it,
 * for a string nobody outside this panel ever reads.
 */

import { useState } from 'react';

import { Checkbox, SelectField, TextAreaField, TextField } from '../components/fields';
import { useI18n } from '../i18n';
import { adminError } from '../lib/errors';
import { setConfirmForm } from '../lib/roles';
import {
  FIELD_TYPES,
  FORM_LIMITS,
  keyFromLabel,
  validateForm,
  type ConfirmField,
  type FieldType,
} from '@shared/confirmForm';

/** One option per line. The line is the stored value and its own label. */
const toLines = (field: ConfirmField) =>
  (field.options ?? []).map((option) => option.value).join('\n');

const fromLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value) => ({ value, label: { en: value } }));

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

  const patch = (index: number, part: Partial<ConfirmField>) =>
    setFields((list) => list.map((field, i) => (i === index ? { ...field, ...part } : field)));

  function add() {
    setFields((list) => [
      ...list,
      { key: '', type: 'text', label: { en: '' }, required: false },
    ]);
  }

  function move(index: number, delta: number) {
    setFields((list) => {
      const next = [...list];
      const to = index + delta;
      if (to < 0 || to >= next.length) return list;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  function remove(index: number) {
    const field = fields[index];
    // Named, because "Remove field 3" is not something anyone can check against
    // the form they meant to change.
    if (!confirm(t.admin.formRemoveConfirm.replace('{label}', field.label.en || '—'))) return;
    setFields((list) => list.filter((_, i) => i !== index));
  }

  async function save() {
    setNote('');
    setError('');

    // Keys are filled in at save rather than as the label is typed: generating
    // on every keystroke would rewrite the key of a field somebody is halfway
    // through renaming, and the key is the one thing that must not move.
    const keyed: ConfirmField[] = [];
    for (const field of fields) {
      keyed.push(
        field.key ? field : { ...field, key: keyFromLabel(field.label.en, keyed.map((f) => f.key)) },
      );
    }

    const fault = validateForm({ fields: keyed });
    if (fault) {
      setError(
        t.admin.formErrors[fault.problem].replace('{key}', fault.key || '—'),
      );
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

      {fields.length === 0 && <p className="muted">{t.admin.formEmpty}</p>}

      {fields.map((field, index) => (
        <fieldset key={index} className="fieldset formfield">
          <legend>{field.label.en || t.admin.formUntitled}</legend>

          <div className="grid grid--2">
            <TextField
              label={t.admin.formLabelEn}
              required
              value={field.label.en}
              onChange={(en) => patch(index, { label: { ...field.label, en } })}
              maxLength={FORM_LIMITS.label}
              disabled={busy}
            />
            <TextField
              label={t.admin.formLabelFr}
              help={t.admin.formLabelFrHelp}
              value={field.label.fr ?? ''}
              onChange={(fr) => patch(index, { label: { ...field.label, fr } })}
              maxLength={FORM_LIMITS.label}
              disabled={busy}
            />
          </div>

          <div className="grid grid--2">
            <TextField
              label={t.admin.formHelpEn}
              value={field.help?.en ?? ''}
              onChange={(en) => patch(index, { help: { ...(field.help ?? { en: '' }), en } })}
              maxLength={FORM_LIMITS.help}
              disabled={busy}
            />
            <TextField
              label={t.admin.formHelpFr}
              value={field.help?.fr ?? ''}
              onChange={(fr) => patch(index, { help: { ...(field.help ?? { en: '' }), fr } })}
              maxLength={FORM_LIMITS.help}
              disabled={busy}
            />
          </div>

          <div className="grid grid--2">
            <SelectField
              label={t.admin.formType}
              required
              value={field.type}
              options={FIELD_TYPES.map((type) => ({ value: type, label: t.admin.formTypes[type] }))}
              onChange={(type) => patch(index, { type: type as FieldType })}
              disabled={busy}
            />
            <Checkbox
              label={t.admin.formRequired}
              checked={field.required}
              onChange={(required) => patch(index, { required })}
              disabled={busy}
            />
          </div>

          {field.type === 'select' && (
            <TextAreaField
              label={t.admin.formOptions}
              required
              help={t.admin.formOptionsHelp}
              value={toLines(field)}
              onChange={(text) => patch(index, { options: fromLines(text) })}
              rows={4}
              disabled={busy}
            />
          )}

          {field.key && <p className="field__help">{t.admin.formKey.replace('{key}', field.key)}</p>}

          <div className="row row--wrap">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy || index === 0}
              onClick={() => move(index, -1)}
            >
              {t.admin.formUp}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy || index === fields.length - 1}
              onClick={() => move(index, 1)}
            >
              {t.admin.formDown}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => remove(index)}
            >
              {t.admin.formRemove}
            </button>
          </div>
        </fieldset>
      ))}

      <div className="row row--wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || fields.length >= FORM_LIMITS.fields}
          onClick={add}
        >
          {t.admin.formAdd}
        </button>
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
