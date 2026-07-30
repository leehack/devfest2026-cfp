/**
 * One editable list of `ConfirmField`s, with the add / reorder / remove chrome.
 *
 * Two forms are built out of these now — the questions asked on acceptance and
 * the ones a call adds to its own submission form — and they are the same shape
 * validated by the same `validateForm`. A second copy of this markup would be a
 * second set of quirks to keep in step, so it is controlled: the parent owns
 * the list and the save, this owns nothing.
 *
 * The key is generated once from the English label by the parent at save time
 * and then shown read-only. It is what every stored answer is filed under, so
 * renaming it would orphan the answers already collected — a data loss with no
 * warning attached to it, for a string nobody outside this panel ever reads.
 */

import { Fragment } from 'react';

import { Checkbox, SelectField, TextAreaField, TextField } from './fields';
import { useI18n } from '../i18n/context';
import { FIELD_TYPES, FORM_LIMITS, type ConfirmField, type FieldType } from '@shared/confirmForm';

/** One option per line. The line is the stored value and its own label. */
const toLines = (field: ConfirmField) =>
  (field.options ?? []).map((option) => option.value).join('\n');

const fromLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value) => ({ value, label: { en: value } }));

export interface FieldRowsProps {
  fields: ConfirmField[];
  onChange: (fields: ConfirmField[]) => void;
  busy: boolean;
  /**
   * Which answer types this list offers. Defaults to all of them; the
   * submission form passes a shorter list because it does not take photographs.
   */
  types?: readonly FieldType[];
  /**
   * A consent is a required checkbox by definition, so its row shows the
   * wording and nothing else — offering "answer type" and "must be answered"
   * would be offering to turn an agreement into a question.
   */
  consent?: boolean;
  max?: number;
  /** Wording, so consents do not call themselves questions. */
  labels: {
    empty: string;
    untitled: string;
    labelEn: string;
    labelFr: string;
    add: string;
    removeConfirm: string;
  };
}

export function FieldRows({
  fields,
  onChange,
  busy,
  types = FIELD_TYPES,
  consent = false,
  max = FORM_LIMITS.fields,
  labels,
}: FieldRowsProps) {
  const { t } = useI18n();

  const patch = (index: number, part: Partial<ConfirmField>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...part } : field)));

  function add() {
    onChange([
      ...fields,
      consent
        ? { key: '', type: 'checkbox', label: { en: '' }, required: true }
        : { key: '', type: types[0] ?? 'text', label: { en: '' }, required: false },
    ]);
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= fields.length) return;
    const next = [...fields];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    // Named, because "Remove field 3" is not something anyone can check against
    // the form they meant to change.
    if (!confirm(labels.removeConfirm.replace('{label}', fields[index].label.en || '—'))) return;
    onChange(fields.filter((_, i) => i !== index));
  }

  /*
   * A consent is a line of wording and nothing else — no type, no "must be
   * answered", no hint. Giving it the full boxed field treatment is what turned
   * three tick boxes into most of a screen, so it gets one row, like a choice.
   */
  if (consent) {
    return (
      <>
        {fields.length === 0 ? (
          <p className="muted">{labels.empty}</p>
        ) : (
          <div className="optionlist__grid optionlist__grid--consent">
            <span className="optionlist__head">{labels.labelEn}</span>
            <span className="optionlist__head">{labels.labelFr}</span>
            <span className="optionlist__head optionlist__head--actions">
              {t.admin.columnOrder}
            </span>

            {fields.map((field, index) => {
              const which = field.label.en || labels.untitled;
              return (
                <Fragment key={index}>
                  <span className="optionlist__cell">
                    <span className="optionlist__mobile-label">{labels.labelEn}</span>
                    <input
                      className="field__input"
                      value={field.label.en}
                      aria-label={`${labels.labelEn} — ${which}`}
                      maxLength={FORM_LIMITS.label}
                      disabled={busy}
                      onChange={(e) =>
                        patch(index, { label: { ...field.label, en: e.target.value } })
                      }
                    />
                  </span>
                  <span className="optionlist__cell">
                    <span className="optionlist__mobile-label">{labels.labelFr}</span>
                    <input
                      className="field__input"
                      value={field.label.fr ?? ''}
                      aria-label={`${labels.labelFr} — ${which}`}
                      maxLength={FORM_LIMITS.label}
                      disabled={busy}
                      onChange={(e) =>
                        patch(index, { label: { ...field.label, fr: e.target.value } })
                      }
                    />
                  </span>
                  <span className="optionlist__cell optionlist__cell--actions">
                    <span className="optionlist__mobile-label">{t.admin.columnOrder}</span>
                    <span className="optionlist__actions">
                      <button
                        type="button"
                        className="iconbtn"
                        disabled={busy || index === 0}
                        aria-label={t.admin.moveUpOf(which)}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="iconbtn"
                        disabled={busy || index === fields.length - 1}
                        aria-label={t.admin.moveDownOf(which)}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="iconbtn iconbtn--danger"
                        disabled={busy}
                        aria-label={t.admin.removeOf(which)}
                        onClick={() => remove(index)}
                      >
                        ✕
                      </button>
                    </span>
                  </span>
                </Fragment>
              );
            })}
          </div>
        )}

        <button
          type="button"
          className="btn btn--small"
          disabled={busy || fields.length >= max}
          onClick={add}
        >
          {labels.add}
        </button>
      </>
    );
  }

  return (
    <>
      {fields.length === 0 && <p className="muted">{labels.empty}</p>}

      {fields.map((field, index) => (
        <fieldset key={index} className="fieldset formfield">
          <legend>{field.label.en || labels.untitled}</legend>

          <div className="grid grid--2">
            <TextField
              label={labels.labelEn}
              required
              value={field.label.en}
              onChange={(en) => patch(index, { label: { ...field.label, en } })}
              maxLength={FORM_LIMITS.label}
              disabled={busy}
            />
            <TextField
              label={labels.labelFr}
              help={t.admin.formLabelFrHelp}
              value={field.label.fr ?? ''}
              onChange={(fr) => patch(index, { label: { ...field.label, fr } })}
              maxLength={FORM_LIMITS.label}
              disabled={busy}
            />
          </div>

          {!consent && (
            <>
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
                  options={types.map((type) => ({ value: type, label: t.admin.formTypes[type] }))}
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
            </>
          )}

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

      <button
        type="button"
        className="btn btn--small"
        disabled={busy || fields.length >= max}
        onClick={add}
      >
        {labels.add}
      </button>
    </>
  );
}
