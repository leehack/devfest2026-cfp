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
import { emailError } from '../lib/errors';
import { sendTestEmail, setEmailTemplate } from '../lib/roles';
import { useLatest } from '../lib/useLatest';
import {
  EMAIL_KINDS,
  DECISION_KINDS,
  CO_SPEAKER_INVITATION_KINDS,
  PLACEHOLDERS,
  ROLE_INVITATION_EMAIL_KINDS,
  SCHEDULE_EMAIL_KINDS,
  STAFF_EMAIL_KINDS,
  activeTemplate,
  builtInTemplate,
  renderBilingualEmail,
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
  ownedTemplates,
  readOnly = false,
  actions,
  onSaved,
  onDirtyChange,
}: {
  cfpId: string;
  cfpName: string;
  configured: boolean;
  /** Effective wording used to render the preview. */
  templates: TemplateOverrides;
  /** Wording owned by this editor, so inherited copy is not presented as a local override. */
  ownedTemplates?: TemplateOverrides;
  readOnly?: boolean;
  actions?: {
    save: (input: {
      kind: EmailKind;
      locale: EmailLocale;
      subject: string;
      body: string;
    }) => Promise<void>;
    reset: (input: { kind: EmailKind; locale: EmailLocale }) => Promise<void>;
    test: (input: {
      kind: EmailKind;
      locale: EmailLocale;
      needsVisa: boolean;
    }) => Promise<{ status: string; to: string }>;
  };
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<EmailKind>('accepted');
  const [previewLocale, setPreviewLocale] = useState<EmailLocale>(locale);
  const [bilingual, setBilingual] = useState(false);
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
  const replaceDraftOnRefresh = useRef(false);
  const localeTouched = useRef(false);
  const dirty =
    !readOnly && (draft.subject !== baseline.subject || draft.body !== baseline.body);
  const dirtyRef = useLatest(dirty);

  // A refresh of the queue may carry a new object containing the same templates.
  // It updates a clean editor, but never writes over a sentence in progress.
  // Switching to a different message is distinct: its own wording must load.
  useEffect(() => {
    const changed = previousSelection.current !== selection;
    const next = activeTemplate(kind, previewLocale, templates);
    if (changed || !dirty || replaceDraftOnRefresh.current) setDraft(next);
    setBaseline(next);
    replaceDraftOnRefresh.current = false;
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

  // The app locale settles after mount. Follow it until the organiser makes an
  // explicit preview-language choice, then preserve that choice. A header
  // language switch must not become an unguarded template selection change.
  useEffect(() => {
    if (!localeTouched.current && !dirtyRef.current) setPreviewLocale(locale);
  }, [dirtyRef, locale]);

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

  const custom = Boolean((ownedTemplates ?? templates)?.[kind]?.[previewLocale]);
  const problem = validateTemplate(draft);
  const staffImmediate = STAFF_EMAIL_KINDS.includes(kind);
  const heldSpeaker = [...DECISION_KINDS, ...SCHEDULE_EMAIL_KINDS].includes(kind);
  const bilingualEligible = [
    ...STAFF_EMAIL_KINDS,
    ...ROLE_INVITATION_EMAIL_KINDS,
    ...CO_SPEAKER_INVITATION_KINDS,
  ].includes(kind);
  const deliveryMode = staffImmediate ? 'staff' : heldSpeaker ? 'held' : 'automatic';
  const sampleOrigin = typeof window === 'undefined' ? 'https://cfp.example.org' : window.location.origin;
  const applicablePlaceholders = PLACEHOLDERS.filter((name) =>
    (['en', 'fr'] as const).some((language) => {
      const template = builtInTemplate(kind, language);
      return `${template.subject}\n${template.body}`.includes(`{${name}}`);
    }),
  );

  const previewOverrides: TemplateOverrides = {
    ...templates,
    [kind]: {
      ...templates[kind],
      [previewLocale]: draft,
    },
  };

  // From the draft, not from storage: the point is to see an edit before saving.
  const sampleData = {
    speakerName: t.admin.emailPreviewSample.speakerName,
    title: t.admin.emailPreviewSample.title,
    proposalUrl: `${sampleOrigin}/c/${cfpId}/submit`,
    // The real name, because {event} appears in every subject line and a
    // stand-in reads as "Your Your event talk has been accepted".
    event: cfpName,
    needsVisa,
    scheduleDate: t.admin.emailPreviewSample.scheduleDate,
    scheduleTime: t.admin.emailPreviewSample.scheduleTime,
    scheduleRoom: t.admin.emailPreviewSample.scheduleRoom,
    scheduleUrl: `${sampleOrigin}/c/${cfpId}/${kind === 'committee_schedule_shared' ? 'schedule' : 'submit'}`,
    reviewUrl: `${sampleOrigin}/c/${cfpId}/review`,
  };
  const email =
    bilingual && bilingualEligible
      ? renderBilingualEmail(kind, sampleData, previewOverrides)
      : renderEmail(kind, previewLocale, sampleData, previewOverrides);

  async function run(fn: () => Promise<string>) {
    if (readOnly) return;
    setBusy(true);
    setNote('');
    setError('');
    try {
      setNote(await fn());
    } catch (e) {
      setError(emailError(e, t));
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
            { value: 'en', label: t.admin.emailLanguageNames.en },
            { value: 'fr', label: t.admin.emailLanguageNames.fr },
          ]}
          onChange={(v) =>
            changeSelection(() => {
              localeTouched.current = true;
              setPreviewLocale(v as EmailLocale);
            })
          }
        />
      </div>

      <div className="row row--wrap email-preview__toggles">
        {/* Only an acceptance has a conditional paragraph, so only it gets a toggle. */}
        {kind === 'accepted' && (
          <Checkbox label={t.admin.emailPreviewVisa} checked={needsVisa} onChange={setNeedsVisa} />
        )}
        <Checkbox label={t.admin.emailPreviewPlain} checked={plain} onChange={setPlain} />
        {bilingualEligible && (
          <Checkbox
            label={t.admin.emailPreviewBilingual}
            checked={bilingual}
            onChange={setBilingual}
          />
        )}
        <Checkbox
          label={t.admin.emailEdit}
          checked={editing}
          onChange={setEditing}
          disabled={readOnly}
        />
        {custom && <span className="muted">{t.admin.emailCustom}</span>}
      </div>

      {bilingualEligible && bilingual && (
        <p className="field__help">{t.admin.emailPreviewBilingualHelp}</p>
      )}

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
            {t.admin.emailApplicablePlaceholders}{' '}
            {applicablePlaceholders.map((name) => (
              <code key={name} className="mono">
                {`{${name}}`}{' '}
              </code>
            ))}
          </p>
          {kind === 'accepted' && <p className="field__help">{t.admin.emailVisaHelp}</p>}

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
                  if (actions) {
                    await actions.save({ kind, locale: previewLocale, ...draft });
                  } else {
                    await setEmailTemplate({ cfpId, kind, locale: previewLocale, ...draft });
                  }
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
                  if (actions) {
                    await actions.reset({ kind, locale: previewLocale });
                  } else {
                    await setEmailTemplate({ cfpId, kind, locale: previewLocale, reset: true });
                  }
                  // A reset deliberately discards the local draft. The normal
                  // refresh path preserves dirty text, so opt this refresh into
                  // replacing it with the newly revealed inherited/built-in copy.
                  replaceDraftOnRefresh.current = true;
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
        disabled={busy || readOnly || !configured || dirty}
        aria-describedby={
          !configured ? 'email-test-setup-help' : dirty ? 'email-test-save-help' : undefined
        }
        onClick={() =>
          run(async () => {
            const data = actions
              ? await actions.test({ kind, locale: previewLocale, needsVisa })
              : (await sendTestEmail({ cfpId, kind, locale: previewLocale, needsVisa })).data;
            return data.status === 'dry_run'
              ? t.admin.emailTestDryRun
              : t.admin.emailTestSent.replace('{to}', data.to);
          })
        }
      >
        {t.admin.emailTest}
      </button>
      {!configured && (
        <p className="field__help" id="email-test-setup-help">
          {t.admin.emailTestNeedsSetup}
        </p>
      )}
      {configured && dirty && (
        <p className="field__help" id="email-test-save-help">
          {t.admin.emailTestSaveFirst}
        </p>
      )}
      {bilingualEligible && bilingual && (
        <p className="field__help">{t.admin.emailPreviewSelectedTest}</p>
      )}

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
