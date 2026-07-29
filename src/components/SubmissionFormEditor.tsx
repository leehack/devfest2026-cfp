/**
 * What this call asks a speaker for: its categories, formats, levels, the
 * languages it will take a talk in, its consents, and anything else it wants.
 *
 * Everything here was hardcoded to DevFest Montréal until now. The shape is
 * deliberately the confirmation form's — `FieldOption`, `ConfirmField`,
 * `validateForm` — because a second form engine would be a second set of bugs.
 *
 * Three rules the UI enforces rather than explains after the fact:
 *
 *  - A stored *value* is never edited in place. It is what every proposal filed
 *    under it says, and renaming it would leave those talks pointing at a code
 *    the form no longer offers. Relabel freely; to retire a choice, remove it.
 *  - `deliveryLanguage`'s values are the code's business as well as the
 *    organiser's — `either` is what the scheduling dashboard counts — so that
 *    list is a set of switches over the four known values, not a free list.
 *  - No photographs. A submission is read by a committee that will turn most of
 *    them down, and holding a picture of someone for that is not something an
 *    organiser should be able to switch on by accident (§3). The acceptance
 *    form is where an image question belongs, and it has one.
 */

import { useState } from 'react';

import { FieldRows } from './FieldRows';
import { withKeys } from './ConfirmFormEditor';
import { Checkbox, TextField } from './fields';
import { useI18n } from '../i18n';
import { adminError } from '../lib/errors';
import { setSubmissionForm } from '../lib/roles';
import { FORM_LIMITS, validateForm, type FieldOption, type FieldType } from '@shared/confirmForm';
import { DELIVERY_LANGUAGES } from '@shared/enums';
import {
  validateSubmissionForm,
  type SubmissionForm,
  type TaxonomyKey,
} from '@shared/submissionForm';

/** Everything but `image` — see the note at the top. */
const EXTRA_TYPES: readonly FieldType[] = ['text', 'textarea', 'select', 'checkbox'];

/** A code from a label, the same way `keyFromLabel` makes one for a field. */
const codeFrom = (label: string, taken: string[]): string => {
  const base =
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'option';
  let code = /^[a-z0-9]/.test(base) ? base : `x_${base}`;
  let n = 2;
  while (taken.includes(code)) code = `${base}_${n++}`;
  return code;
};

/** One of the three free lists: category, format, level. */
function OptionList({
  legend,
  options,
  onChange,
  busy,
}: {
  legend: string;
  options: FieldOption[];
  onChange: (options: FieldOption[]) => void;
  busy: boolean;
}) {
  const { t } = useI18n();

  const patch = (index: number, part: Partial<FieldOption>) =>
    onChange(options.map((o, i) => (i === index ? { ...o, ...part } : o)));

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= options.length) return;
    const next = [...options];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  return (
    <fieldset className="fieldset formfield">
      <legend>{legend}</legend>

      {options.length === 0 && <p className="muted">{t.admin.optionsEmpty}</p>}

      {options.map((option, index) => (
        <div className="formfield__row" key={index}>
          <div className="grid grid--2">
            <TextField
              label={t.admin.optionLabelEn}
              required
              value={option.label.en}
              onChange={(en) => patch(index, { label: { ...option.label, en } })}
              maxLength={FORM_LIMITS.optionLabel}
              disabled={busy}
            />
            <TextField
              label={t.admin.optionLabelFr}
              help={t.admin.formLabelFrHelp}
              value={option.label.fr ?? ''}
              onChange={(fr) => patch(index, { label: { ...option.label, fr } })}
              maxLength={FORM_LIMITS.optionLabel}
              disabled={busy}
            />
          </div>

          <div className="row row--wrap">
            {option.value && (
              <span className="field__help">
                {t.admin.optionCode.replace('{code}', option.value)}
              </span>
            )}
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
              disabled={busy || index === options.length - 1}
              onClick={() => move(index, 1)}
            >
              {t.admin.formDown}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => {
                if (!confirm(t.admin.optionRemoveConfirm.replace('{label}', option.label.en || '—')))
                  return;
                onChange(options.filter((_, i) => i !== index));
              }}
            >
              {t.admin.formRemove}
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn"
        disabled={busy || options.length >= FORM_LIMITS.options}
        onClick={() => onChange([...options, { value: '', label: { en: '' } }])}
      >
        {t.admin.optionAdd}
      </button>
    </fieldset>
  );
}

/**
 * The languages, which are switches rather than a list. Unchecking one stops it
 * being offered; the value itself is fixed, so a talk already submitted in it
 * still reads back correctly.
 */
function LanguageList({
  options,
  onChange,
  busy,
}: {
  options: FieldOption[];
  onChange: (options: FieldOption[]) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const at = (value: string) => options.find((o) => o.value === value);

  return (
    <fieldset className="fieldset formfield">
      <legend>{t.admin.taxonomy.deliveryLanguage}</legend>
      <p className="field__help">{t.admin.languagesHelp}</p>

      {DELIVERY_LANGUAGES.map((value) => {
        const option = at(value);
        return (
          <div className="formfield__row" key={value}>
            <Checkbox
              label={t.enums.deliveryLanguage[value]}
              checked={Boolean(option)}
              disabled={busy}
              onChange={(on) =>
                onChange(
                  on
                    ? // Back in the order the code lists them, not at the end,
                      // so toggling twice does not reshuffle the dropdown.
                      DELIVERY_LANGUAGES.filter(
                        (v) => v === value || options.some((o) => o.value === v),
                      ).map(
                        (v) =>
                          at(v) ?? { value: v, label: { en: t.enums.deliveryLanguage[v] } },
                      )
                    : options.filter((o) => o.value !== value),
                )
              }
            />
            {option && (
              <div className="grid grid--2">
                <TextField
                  label={t.admin.optionLabelEn}
                  required
                  value={option.label.en}
                  onChange={(en) =>
                    onChange(
                      options.map((o) =>
                        o.value === value ? { ...o, label: { ...o.label, en } } : o,
                      ),
                    )
                  }
                  maxLength={FORM_LIMITS.optionLabel}
                  disabled={busy}
                />
                <TextField
                  label={t.admin.optionLabelFr}
                  value={option.label.fr ?? ''}
                  onChange={(fr) =>
                    onChange(
                      options.map((o) =>
                        o.value === value ? { ...o, label: { ...o.label, fr } } : o,
                      ),
                    )
                  }
                  maxLength={FORM_LIMITS.optionLabel}
                  disabled={busy}
                />
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

export function SubmissionFormEditor({ cfpId, form: saved }: { cfpId: string; form: SubmissionForm }) {
  const { t } = useI18n();
  const [form, setForm] = useState<SubmissionForm>(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const set = <K extends keyof SubmissionForm>(key: K, value: SubmissionForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setNote('');
    setError('');

    // Codes and keys are minted here, at save, for the same reason the
    // confirmation form mints its keys here: doing it per keystroke would
    // rewrite the identity of something being renamed.
    const coded = (list: FieldOption[]) => {
      const out: FieldOption[] = [];
      for (const option of list) {
        out.push(
          option.value
            ? option
            : { ...option, value: codeFrom(option.label.en, out.map((o) => o.value)) },
        );
      }
      return out;
    };

    const next: SubmissionForm = {
      category: coded(form.category),
      format: coded(form.format),
      level: coded(form.level),
      deliveryLanguage: form.deliveryLanguage,
      acks: withKeys(form.acks),
      fields: withKeys(form.fields),
    };

    const fault = validateSubmissionForm(next);
    if (fault) {
      setError(
        t.admin.submissionErrors[fault.problem].replace(
          '{key}',
          fault.key ? (t.admin.taxonomy[fault.key as TaxonomyKey] ?? fault.key) : '—',
        ),
      );
      return;
    }
    for (const fields of [next.acks, next.fields]) {
      const bad = validateForm({ fields });
      if (bad) {
        setError(t.admin.formErrors[bad.problem].replace('{key}', bad.key || '—'));
        return;
      }
    }

    setBusy(true);
    try {
      const { data } = await setSubmissionForm({ cfpId, ...next });
      // What was actually stored, not what we sent: the callable trims and drops.
      setForm(data.form);
      setNote(t.admin.submissionSaved);
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="field__help">{t.admin.submissionHelp}</p>

      {(['category', 'format', 'level'] as TaxonomyKey[]).map((key) => (
        <OptionList
          key={key}
          legend={t.admin.taxonomy[key]}
          options={form[key]}
          onChange={(options) => set(key, options)}
          busy={busy}
        />
      ))}

      <LanguageList
        options={form.deliveryLanguage}
        onChange={(options) => set('deliveryLanguage', options)}
        busy={busy}
      />

      <h3 className="card__subtitle">{t.admin.acksTitle}</h3>
      <p className="field__help">{t.admin.acksHelp}</p>
      <FieldRows
        fields={form.acks}
        onChange={(acks) => set('acks', acks)}
        busy={busy}
        consent
        max={FORM_LIMITS.fields}
        labels={{
          empty: t.admin.acksEmpty,
          untitled: t.admin.ackUntitled,
          labelEn: t.admin.ackLabelEn,
          labelFr: t.admin.ackLabelFr,
          add: t.admin.ackAdd,
          removeConfirm: t.admin.ackRemoveConfirm,
        }}
      />

      <h3 className="card__subtitle">{t.admin.extraTitle}</h3>
      <p className="field__help">{t.admin.extraHelp}</p>
      <FieldRows
        fields={form.fields}
        onChange={(fields) => set('fields', fields)}
        busy={busy}
        types={EXTRA_TYPES}
        labels={{
          empty: t.admin.extraEmpty,
          untitled: t.admin.formUntitled,
          labelEn: t.admin.formLabelEn,
          labelFr: t.admin.formLabelFr,
          add: t.admin.extraAdd,
          removeConfirm: t.admin.formRemoveConfirm,
        }}
      />

      <div className="row row--wrap">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>
          {busy ? t.admin.formSaving : t.admin.submissionSave}
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
