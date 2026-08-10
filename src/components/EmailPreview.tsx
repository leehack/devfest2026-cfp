/**
 * What each message actually looks like, and the wording behind it.
 *
 * The preview renders through the same pure `renderEmail` the sender uses, so
 * this is the message rather than an impression of it — and because it renders
 * from the text in the editor rather than from what is stored, an unsaved edit
 * is visible before it can reach anyone.
 *
 * Worth having on screen: these five emails are the entire relationship most
 * applicants will have with the event.
 */

import { useEffect, useRef, useState } from 'react';

import { SelectField, TextField, TextAreaField, Checkbox } from './fields';
import { useI18n } from '../i18n/context';
import { adminError } from '../lib/errors';
import { sendTestEmail, setEmailTemplate } from '../lib/roles';
import {
  EMAIL_KINDS,
  DECISION_KINDS,
  PLACEHOLDERS,
  SCHEDULE_EMAIL_KINDS,
  STAFF_EMAIL_KINDS,
  activeTemplate,
  builtInTemplate,
  renderEmail,
  validateTemplate,
  type EmailKind,
  type EmailLocale,
  type Template,
  type TemplateOverrides,
} from '@shared/emailTemplates';

export function EmailPreview({
  cfpId,
  cfpName,
  configured,
  templates,
  readOnly = false,
  onSaved,
  onDirtyChange,
}: {
  cfpId: string;
  cfpName: string;
  configured: boolean;
  templates: TemplateOverrides;
  readOnly?: boolean;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<EmailKind>('accepted');
  const [previewLocale, setPreviewLocale] = useState<EmailLocale>(locale);
  const [needsVisa, setNeedsVisa] = useState(true);
  const [plain, setPlain] = useState(false);
  const [editing, setEditing] = useState(false);
  const initial = activeTemplate(kind, previewLocale, templates);
  const [draft, setDraft] = useState<Template>(initial);
  const [baseline, setBaseline] = useState<Template>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const selection = `${kind}:${previewLocale}`;
  const previousSelection = useRef(selection);
  const dirty =
    !readOnly && (draft.subject !== baseline.subject || draft.body !== baseline.body);

  // A refresh of the queue may carry a new object containing the same templates.
  // It updates a clean editor, but never writes over a sentence in progress.
  // Switching to a different message is distinct: its own wording must load.
  useEffect(() => {
    const changed = previousSelection.current !== selection;
    const next = activeTemplate(kind, previewLocale, templates);
    if (changed || !dirty) setDraft(next);
    setBaseline(next);
    previousSelection.current = selection;
    if (changed) {
      setNote('');
      setError('');
    }
    // `dirty` describes the draft before this server snapshot. Adding it as a
    // dependency would immediately run again after `setBaseline` and erase the
    // protected draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, templates]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  function changeSelection(work: () => void) {
    if (dirty && !window.confirm(t.admin.unsaved)) return;
    work();
  }

  const custom = Boolean(templates?.[kind]?.[previewLocale]);
  const problem = validateTemplate(draft);
  const staffImmediate = STAFF_EMAIL_KINDS.includes(kind);
  const heldSpeaker = [...DECISION_KINDS, ...SCHEDULE_EMAIL_KINDS].includes(kind);
  const deliveryMode = staffImmediate ? 'staff' : heldSpeaker ? 'held' : 'automatic';
  const sampleOrigin = typeof window === 'undefined' ? 'https://cfp.example.org' : window.location.origin;

  // From the draft, not from storage: the point is to see an edit before saving.
  const email = renderEmail(
    kind,
    previewLocale,
    {
      speakerName: 'Ada Lovelace',
      title: 'Notes on the Analytical Engine',
      proposalUrl: `${sampleOrigin}/c/${cfpId}/submit`,
      // The real name, because {event} appears in every subject line and a
      // stand-in reads as "Your Your event talk has been accepted".
      event: cfpName,
      needsVisa,
      scheduleDate: 'Saturday, November 14',
      scheduleTime: '10:00–10:40',
      scheduleRoom: 'Room A',
      scheduleUrl: `${sampleOrigin}/c/${cfpId}/${kind === 'committee_schedule_shared' ? 'schedule' : 'submit'}`,
      reviewUrl: `${sampleOrigin}/c/${cfpId}/review`,
    },
    { [kind]: { [previewLocale]: draft } },
  );

  async function run(fn: () => Promise<string>) {
    if (readOnly) return;
    setBusy(true);
    setNote('');
    setError('');
    try {
      setNote(await fn());
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="email-editor">
      <div className="grid grid--2">
        <SelectField
          label={t.admin.emailKind}
          required
          value={kind}
          options={EMAIL_KINDS.map((k) => ({ value: k, label: t.admin.emailKinds[k] ?? k }))}
          onChange={(v) => changeSelection(() => setKind(v as EmailKind))}
        />
        <SelectField
          label={t.admin.emailPreviewLocale}
          required
          value={previewLocale}
          options={[
            { value: 'en', label: 'English' },
            { value: 'fr', label: 'Français' },
          ]}
          onChange={(v) => changeSelection(() => setPreviewLocale(v as EmailLocale))}
        />
      </div>

      <div className="row row--wrap email-preview__toggles">
        {/* Only an acceptance has a conditional paragraph, so only it gets a toggle. */}
        {kind === 'accepted' && (
          <Checkbox label={t.admin.emailPreviewVisa} checked={needsVisa} onChange={setNeedsVisa} />
        )}
        <Checkbox label={t.admin.emailPreviewPlain} checked={plain} onChange={setPlain} />
        <Checkbox
          label={t.admin.emailEdit}
          checked={editing}
          onChange={setEditing}
          disabled={readOnly}
        />
        {custom && <span className="muted">{t.admin.emailCustom}</span>}
      </div>

      <aside className={`email-delivery-mode email-delivery-mode--${deliveryMode}`}>
        <strong>
          {staffImmediate
            ? t.admin.emailDeliveryImmediateStaff
            : heldSpeaker
              ? t.admin.emailDeliveryHeldSpeaker
              : t.admin.emailDeliveryAutomatic}
        </strong>
        <span>
          {staffImmediate
            ? t.admin.emailDeliveryImmediateStaffHelp
            : heldSpeaker
              ? t.admin.emailDeliveryHeldSpeakerHelp
              : t.admin.emailDeliveryAutomaticHelp}
        </span>
      </aside>

      {editing && (
        <div className="editor">
          <TextField
            label={t.admin.emailSubjectLabel}
            required
            value={draft.subject}
            onChange={(subject) => setDraft((d) => ({ ...d, subject }))}
            disabled={busy || readOnly}
          />
          <TextAreaField
            label={t.admin.emailBodyLabel}
            required
            rows={14}
            value={draft.body}
            onChange={(body) => setDraft((d) => ({ ...d, body }))}
            disabled={busy || readOnly}
          />
          <p className="field__help">
            {t.admin.emailPlaceholders}{' '}
            {PLACEHOLDERS.map((name) => (
              <code key={name} className="mono">
                {`{${name}}`}{' '}
              </code>
            ))}
          </p>
          <p className="field__help">{t.admin.emailVisaHelp}</p>

          {problem && (
            <p className="field__error" role="alert">
              {t.admin.emailTemplateProblem[problem.problem].replace('{name}', problem.detail ?? '')}
            </p>
          )}

          <div className="row row--wrap">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || readOnly || Boolean(problem)}
              onClick={() =>
                run(async () => {
                  await setEmailTemplate({ cfpId, kind, locale: previewLocale, ...draft });
                  setBaseline(draft);
                  await onSaved();
                  return t.admin.emailTemplateSaved;
                })
              }
            >
              {t.admin.emailTemplateSave}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || readOnly || !custom}
              onClick={() =>
                run(async () => {
                  await setEmailTemplate({ cfpId, kind, locale: previewLocale, reset: true });
                  const restored = builtInTemplate(kind, previewLocale);
                  setDraft(restored);
                  setBaseline(restored);
                  await onSaved();
                  return t.admin.emailTemplateReset;
                })
              }
            >
              {t.admin.emailTemplateRestore}
            </button>
          </div>
        </div>
      )}

      <p className="preview__subject">
        <span className="muted">{t.admin.emailSubject}</span> <strong>{email.subject}</strong>
      </p>

      {plain ? (
        <pre className="preview__text">{email.text}</pre>
      ) : (
        <iframe
          className="preview__frame"
          title={t.admin.emailPreview}
          sandbox=""
          srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">${email.html}</body>`}
        />
      )}

      <button
        type="button"
        className="btn"
        disabled={busy || readOnly}
        onClick={() =>
          run(async () => {
            const { data } = await sendTestEmail({ cfpId, kind, locale: previewLocale, needsVisa });
            return data.status === 'dry_run'
              ? t.admin.emailTestDryRun
              : t.admin.emailTestSent.replace('{to}', data.to);
          })
        }
      >
        {t.admin.emailTest}
      </button>
      {!configured && <p className="field__help">{t.admin.emailTestNeedsSetup}</p>}

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
    </div>
  );
}
