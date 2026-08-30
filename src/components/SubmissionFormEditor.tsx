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
 *
 * On the shape of the page. The first version gave every choice a full field
 * treatment — two labelled inputs and three buttons each — which came to 5,300
 * pixels, 68 buttons and the words "Label (English)" thirty-six times, with the
 * save button below all of it. A choice is one short string; it gets one row,
 * and the column headings are said once. The bar at the bottom stays put so
 * saving is never a scroll away from the thing being edited, and each list
 * carries the dropdown it produces, because an organiser reading "app_dev,
 * ai_ml, cloud" is doing translation work the page should be doing for them.
 */

import { useEffect, useMemo, useState } from 'react';

import { FieldRows } from './FieldRows';
import { withKeys } from './ConfirmFormEditor';
import { Checkbox, TextField } from './fields';
import { useI18n } from '../i18n/context';
import { adminError } from '../lib/errors';
import { invalidateCache } from '../lib/cache';
import { setSubmissionForm } from '../lib/roles';
import {
  FORM_LIMITS,
  localised,
  validateForm,
  type FieldOption,
  type FieldType,
  type Localised,
} from '@shared/confirmForm';
import { DELIVERY_LANGUAGES } from '@shared/enums';
import {
  DEFAULT_SUBMISSION_FORM,
  validateSubmissionForm,
  type SubmissionAttendanceField,
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
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'option';
  let code = /^[a-z0-9]/.test(base) ? base : `x_${base}`;
  let n = 2;
  while (taken.includes(code)) code = `${base}_${n++}`;
  return code;
};

/**
 * The dropdown this list produces, disabled, in the reader's language.
 *
 * Not decoration: the stored codes are what the editor shows and the labels are
 * what a speaker reads, and those diverge the moment anybody renames anything.
 * Seeing the real control is how an organiser notices they have two choices
 * called "Other".
 */
function Preview({ options }: { options: FieldOption[] }) {
  const { t, locale } = useI18n();
  if (options.length === 0) return null;
  return (
    <p className="optionlist__preview">
      <span className="muted">{t.admin.previewLabel}</span>{' '}
      <select className="field__input field__input--inline" disabled>
        {options.map((option, i) => (
          <option key={i}>{localised(option.label, locale) || option.value || '—'}</option>
        ))}
      </select>
    </p>
  );
}

/** One of the three free lists: category, format, level. One row per choice. */
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
    <fieldset className="fieldset optionlist">
      <legend>
        {legend} <span className="muted">· {t.admin.choiceCount(options.length)}</span>
      </legend>

      <Preview options={options} />

      {options.length === 0 ? (
        <p className="muted">{t.admin.optionsEmpty}</p>
      ) : (
        <div className="optionlist__grid">
          {/* Said once, as column headings, rather than on all thirty-six inputs. */}
          <span className="optionlist__head">{t.admin.columnEnglish}</span>
          <span className="optionlist__head">{t.admin.columnFrench}</span>
          <span className="optionlist__head">{t.admin.columnCode}</span>
          <span className="optionlist__head optionlist__head--actions">
            {t.admin.columnOrder}
          </span>

          {options.map((option, index) => (
            <Row
              key={index}
              option={option}
              index={index}
              count={options.length}
              busy={busy}
              onPatch={(part) => patch(index, part)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => {
                if (!confirm(t.admin.optionRemoveConfirm.replace('{label}', option.label.en || '—')))
                  return;
                onChange(options.filter((_, i) => i !== index));
              }}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn btn--small"
        disabled={busy || options.length >= FORM_LIMITS.options}
        onClick={() => onChange([...options, { value: '', label: { en: '' } }])}
      >
        {t.admin.optionAdd}
      </button>
    </fieldset>
  );
}

/**
 * Bare inputs with `aria-label`, not `TextField`. The visible heading is the
 * column, and repeating it per row is what made the page five screens long —
 * but a screen reader still has to be told which cell it is in, so the label
 * moves to the attribute rather than disappearing.
 */
function Row({
  option,
  index,
  count,
  busy,
  onPatch,
  onMove,
  onRemove,
}: {
  option: FieldOption;
  index: number;
  count: number;
  busy: boolean;
  onPatch: (part: Partial<FieldOption>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const which = option.label.en || t.admin.optionUnnamed;

  return (
    <>
      <span className="optionlist__cell">
        <span className="optionlist__mobile-label">{t.admin.columnEnglish}</span>
        <input
          className="field__input"
          value={option.label.en}
          aria-label={t.admin.optionLabelEnFor(which)}
          maxLength={FORM_LIMITS.optionLabel}
          disabled={busy}
          onChange={(e) => onPatch({ label: { ...option.label, en: e.target.value } })}
        />
      </span>
      <span className="optionlist__cell">
        <span className="optionlist__mobile-label">{t.admin.columnFrench}</span>
        <input
          className="field__input"
          value={option.label.fr ?? ''}
          aria-label={t.admin.optionLabelFrFor(which)}
          maxLength={FORM_LIMITS.optionLabel}
          disabled={busy}
          onChange={(e) => onPatch({ label: { ...option.label, fr: e.target.value } })}
        />
      </span>
      {/* Shown, never editable: every proposal filed under it says this. */}
      <span className="optionlist__cell">
        <span className="optionlist__mobile-label">{t.admin.columnCode}</span>
        <code className="optionlist__code" title={t.admin.optionCodeHelp}>
          {option.value || t.admin.optionCodeOnSave}
        </code>
      </span>
      <span className="optionlist__cell optionlist__cell--actions">
        <span className="optionlist__mobile-label">{t.admin.columnOrder}</span>
        <span className="optionlist__actions">
          <button
            type="button"
            className="iconbtn"
            disabled={busy || index === 0}
            aria-label={t.admin.moveUpOf(which)}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="iconbtn"
            disabled={busy || index === count - 1}
            aria-label={t.admin.moveDownOf(which)}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="iconbtn iconbtn--danger"
            disabled={busy}
            aria-label={t.admin.removeOf(which)}
            onClick={onRemove}
          >
            ✕
          </button>
        </span>
      </span>
    </>
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
    <fieldset className="fieldset optionlist">
      <legend>
        {t.admin.taxonomy.deliveryLanguage}{' '}
        <span className="muted">· {t.admin.choiceCount(options.length)}</span>
      </legend>
      <p className="field__help">{t.admin.languagesHelp}</p>

      <Preview options={options} />

      {DELIVERY_LANGUAGES.map((value) => {
        const option = at(value);
        return (
          <div className="langrow" key={value}>
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
                          at(v) ??
                          DEFAULT_SUBMISSION_FORM.deliveryLanguage.find(
                            (candidate) => candidate.value === v,
                          )!,
                      )
                    : options.filter((o) => o.value !== value),
                )
              }
            />
            {option && (
              <span className="langrow__labels">
                <input
                  className="field__input"
                  value={option.label.en}
                  aria-label={t.admin.optionLabelEnFor(t.enums.deliveryLanguage[value])}
                  maxLength={FORM_LIMITS.optionLabel}
                  disabled={busy}
                  onChange={(e) =>
                    onChange(
                      options.map((o) =>
                        o.value === value ? { ...o, label: { ...o.label, en: e.target.value } } : o,
                      ),
                    )
                  }
                />
                <input
                  className="field__input"
                  value={option.label.fr ?? ''}
                  aria-label={t.admin.optionLabelFrFor(t.enums.deliveryLanguage[value])}
                  maxLength={FORM_LIMITS.optionLabel}
                  disabled={busy}
                  onChange={(e) =>
                    onChange(
                      options.map((o) =>
                        o.value === value ? { ...o, label: { ...o.label, fr: e.target.value } } : o,
                      ),
                    )
                  }
                />
              </span>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

/** One event-owned piece of bilingual attendance copy. */
function AttendanceCopy({
  label,
  value,
  onChange,
  busy,
  help = false,
}: {
  label: string;
  value: Localised;
  onChange: (value: Localised) => void;
  busy: boolean;
  /** Help copy may be omitted; labels and questions may not. */
  help?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="attendance-editor__copy" role="group" aria-label={label}>
      <p className="attendance-editor__copy-label">{label}</p>
      <div className="grid grid--2">
        <TextField
          label={`${label} · ${t.admin.columnEnglish}`}
          value={value.en}
          onChange={(en) => onChange({ ...value, en })}
          maxLength={help ? FORM_LIMITS.help : FORM_LIMITS.label}
          disabled={busy}
          required={!help}
        />
        <TextField
          label={`${label} · ${t.admin.columnFrench}`}
          value={value.fr ?? ''}
          onChange={(fr) => onChange({ ...value, fr })}
          maxLength={help ? FORM_LIMITS.help : FORM_LIMITS.label}
          disabled={busy}
        />
      </div>
    </div>
  );
}

function AttendanceFieldEditor({
  title,
  enabledLabel,
  reviewerLabel,
  labelLabel,
  helpLabel,
  value,
  onChange,
  busy,
}: {
  title: string;
  enabledLabel: string;
  reviewerLabel: string;
  labelLabel: string;
  helpLabel: string;
  value: SubmissionAttendanceField;
  onChange: (value: SubmissionAttendanceField) => void;
  busy: boolean;
}) {
  return (
    <section className="attendance-editor__field" aria-label={title}>
      <h4>{title}</h4>
      <div className="attendance-editor__toggles">
        <Checkbox
          label={enabledLabel}
          checked={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
          disabled={busy}
        />
        {value.enabled && (
          <Checkbox
            label={reviewerLabel}
            checked={value.reviewerVisible}
            onChange={(reviewerVisible) => onChange({ ...value, reviewerVisible })}
            disabled={busy}
          />
        )}
      </div>
      {value.enabled && (
        <>
          <AttendanceCopy
            label={labelLabel}
            value={value.label}
            onChange={(label) => onChange({ ...value, label })}
            busy={busy}
          />
          <AttendanceCopy
            label={helpLabel}
            value={value.help ?? { en: '' }}
            onChange={(help) => onChange({ ...value, help })}
            busy={busy}
            help
          />
        </>
      )}
    </section>
  );
}

export function SubmissionFormEditor({
  cfpId,
  form: saved,
  readOnly = false,
  onDirtyChange,
}: {
  cfpId: string;
  form: SubmissionForm;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<SubmissionForm>(saved);
  const [stored, setStored] = useState<SubmissionForm>(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // Against the last thing the server confirmed, not against a dirty flag: an
  // organiser who types a word and deletes it again has not changed anything,
  // and telling them they have is how a save prompt stops being believed.
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

  const set = <K extends keyof SubmissionForm>(key: K, value: SubmissionForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    if (readOnly) return;
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
      attendance: form.attendance,
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
      setStored(data.form);
      invalidateCache(`submissionForm:${cfpId}`);
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
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
          busy={busy || readOnly}
        />
      ))}

      <LanguageList
        options={form.deliveryLanguage}
        onChange={(options) => set('deliveryLanguage', options)}
        busy={busy || readOnly}
      />

      <fieldset className="fieldset optionlist attendance-editor">
        <legend>{t.admin.attendanceTitle}</legend>
        <p className="field__help">{t.admin.attendanceEditorHelp}</p>
        <Checkbox
          label={t.admin.attendanceEnabled}
          help={t.admin.attendanceEnabledHelp}
          checked={form.attendance.enabled}
          onChange={(enabled) => set('attendance', { ...form.attendance, enabled })}
          disabled={busy || readOnly}
        />

        {form.attendance.enabled && (
          <div className="attendance-editor__body">
            <AttendanceCopy
              label={t.admin.attendanceCopy.title}
              value={form.attendance.title}
              onChange={(title) => set('attendance', { ...form.attendance, title })}
              busy={busy || readOnly}
            />
            <AttendanceCopy
              label={t.admin.attendanceCopy.question}
              value={form.attendance.question}
              onChange={(question) => set('attendance', { ...form.attendance, question })}
              busy={busy || readOnly}
            />
            <AttendanceCopy
              label={t.admin.attendanceCopy.help}
              value={form.attendance.help ?? { en: '' }}
              onChange={(help) => set('attendance', { ...form.attendance, help })}
              busy={busy || readOnly}
              help
            />

            <div className="attendance-editor__answers">
              <div className="attendance-editor__status-heading">
                <p className="attendance-editor__copy-label">{t.admin.attendanceStatusTitle}</p>
                <Checkbox
                  label={t.admin.attendanceReviewerVisible}
                  help={t.admin.attendanceReviewerVisibleHelp}
                  checked={form.attendance.statusReviewerVisible}
                  onChange={(statusReviewerVisible) =>
                    set('attendance', { ...form.attendance, statusReviewerVisible })
                  }
                  disabled={busy || readOnly}
                />
              </div>
              <Preview options={form.attendance.statuses} />
              {form.attendance.statuses.map((status, index) => {
                const copyKey = status.value as 'local' | 'secured' | 'pending';
                return (
                  <AttendanceCopy
                    key={status.value}
                    label={t.admin.attendanceCopy[copyKey]}
                    value={status.label}
                    onChange={(label) =>
                      set('attendance', {
                        ...form.attendance,
                        statuses: form.attendance.statuses.map((candidate, candidateIndex) =>
                          candidateIndex === index ? { ...candidate, label } : candidate,
                        ),
                      })
                    }
                    busy={busy || readOnly}
                  />
                );
              })}
            </div>

            {(['fundingSource', 'decisionBy', 'needsVisa'] as const).map((key) => (
              <AttendanceFieldEditor
                key={key}
                title={t.admin.attendanceFields[key]}
                enabledLabel={t.admin.attendanceFieldEnabled}
                reviewerLabel={t.admin.attendanceReviewerVisible}
                labelLabel={t.admin.attendanceCopy[key]}
                helpLabel={t.admin.attendanceCopy[`${key}Help` as keyof typeof t.admin.attendanceCopy]}
                value={form.attendance[key]}
                onChange={(value) => set('attendance', { ...form.attendance, [key]: value })}
                busy={busy || readOnly}
              />
            ))}

            <AttendanceCopy
              label={t.admin.attendanceCopy.gdeGuidance}
              value={form.attendance.gdeGuidance ?? { en: '' }}
              onChange={(gdeGuidance) => set('attendance', { ...form.attendance, gdeGuidance })}
              busy={busy || readOnly}
              help
            />
          </div>
        )}
      </fieldset>

      <fieldset className="fieldset optionlist">
        <legend>{t.admin.acksTitle}</legend>
        <p className="field__help">{t.admin.acksHelp}</p>
        <FieldRows
          fields={form.acks}
          onChange={(acks) => set('acks', acks)}
          busy={busy || readOnly}
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
      </fieldset>

      <fieldset className="fieldset optionlist">
        <legend>{t.admin.extraTitle}</legend>
        <p className="field__help">{t.admin.extraHelp}</p>
        <FieldRows
          fields={form.fields}
          onChange={(fields) => set('fields', fields)}
          busy={busy || readOnly}
          types={EXTRA_TYPES}
          reviewerVisibility={{
            label: t.admin.extraReviewerVisible,
            help: t.admin.extraReviewerVisibleHelp,
          }}
          labels={{
            empty: t.admin.extraEmpty,
            untitled: t.admin.formUntitled,
            labelEn: t.admin.formLabelEn,
            labelFr: t.admin.formLabelFr,
            add: t.admin.extraAdd,
            removeConfirm: t.admin.formRemoveConfirm,
          }}
        />
      </fieldset>

      {/*
        Stays with you down the page. The save used to sit below five screens of
        inputs, which meant every error message did too — you fixed something at
        the top, scrolled to the bottom to save, and scrolled back to read what
        was wrong.
      */}
      <div className="editorbar" role="region" aria-label={t.admin.submissionSave}>
        <div className="editorbar__inner">
          <p className="editorbar__state" aria-live="polite">
            {error ? (
              <span className="editorbar__error">{error}</span>
            ) : busy ? (
              t.admin.formSaving
            ) : dirty ? (
              t.admin.unsaved
            ) : (
              note || t.admin.upToDate
            )}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || readOnly || !dirty}
            onClick={save}
          >
            {busy ? t.admin.formSaving : t.admin.submissionSave}
          </button>
        </div>
      </div>
    </>
  );
}
