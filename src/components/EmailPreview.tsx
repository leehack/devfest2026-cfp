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

import { useEffect, useState } from 'react';

import { SelectField, TextField, TextAreaField, Checkbox } from './fields';
import { useI18n } from '../i18n';
import { adminError } from '../lib/errors';
import { sendTestEmail, setEmailTemplate } from '../lib/roles';
import {
  EMAIL_KINDS,
  PLACEHOLDERS,
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
  configured,
  templates,
  onSaved,
}: {
  configured: boolean;
  templates: TemplateOverrides;
  onSaved: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<EmailKind>('accepted');
  const [previewLocale, setPreviewLocale] = useState<EmailLocale>(locale);
  const [needsVisa, setNeedsVisa] = useState(true);
  const [plain, setPlain] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Template>(() => activeTemplate(kind, previewLocale, templates));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // Switching message or language loads that one's wording. Deliberately not
  // guarded by an unsaved-changes check — the selectors are how you browse, and
  // Reset is one click away.
  useEffect(() => {
    setDraft(activeTemplate(kind, previewLocale, templates));
    setNote('');
    setError('');
  }, [kind, previewLocale, templates]);

  const custom = Boolean(templates?.[kind]?.[previewLocale]);
  const problem = validateTemplate(draft);

  // From the draft, not from storage: the point is to see an edit before saving.
  const email = renderEmail(
    kind,
    previewLocale,
    {
      speakerName: 'Ada Lovelace',
      title: 'Notes on the Analytical Engine',
      proposalUrl: `${window.location.origin}/#/`,
      needsVisa,
    },
    { [kind]: { [previewLocale]: draft } },
  );

  async function run(fn: () => Promise<string>) {
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
    <div>
      <div className="grid grid--3">
        <SelectField
          label={t.admin.emailKind}
          required
          value={kind}
          options={EMAIL_KINDS.map((k) => ({ value: k, label: t.admin.emailKinds[k] ?? k }))}
          onChange={(v) => setKind(v as EmailKind)}
        />
        <SelectField
          label={t.admin.emailPreviewLocale}
          required
          value={previewLocale}
          options={[
            { value: 'en', label: 'English' },
            { value: 'fr', label: 'Français' },
          ]}
          onChange={(v) => setPreviewLocale(v as EmailLocale)}
        />
      </div>

      <div className="row row--wrap">
        {/* Only an acceptance has a conditional paragraph, so only it gets a toggle. */}
        {kind === 'accepted' && (
          <Checkbox label={t.admin.emailPreviewVisa} checked={needsVisa} onChange={setNeedsVisa} />
        )}
        <Checkbox label={t.admin.emailPreviewPlain} checked={plain} onChange={setPlain} />
        <Checkbox label={t.admin.emailEdit} checked={editing} onChange={setEditing} />
        {custom && <span className="muted">{t.admin.emailCustom}</span>}
      </div>

      {editing && (
        <div className="editor">
          <TextField
            label={t.admin.emailSubjectLabel}
            required
            value={draft.subject}
            onChange={(subject) => setDraft((d) => ({ ...d, subject }))}
            disabled={busy}
          />
          <TextAreaField
            label={t.admin.emailBodyLabel}
            required
            rows={14}
            value={draft.body}
            onChange={(body) => setDraft((d) => ({ ...d, body }))}
            disabled={busy}
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
              disabled={busy || Boolean(problem)}
              onClick={() =>
                run(async () => {
                  await setEmailTemplate({ kind, locale: previewLocale, ...draft });
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
              disabled={busy || !custom}
              onClick={() =>
                run(async () => {
                  await setEmailTemplate({ kind, locale: previewLocale, reset: true });
                  setDraft(builtInTemplate(kind, previewLocale));
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
        disabled={busy}
        onClick={() =>
          run(async () => {
            const { data } = await sendTestEmail({ kind, locale: previewLocale, needsVisa });
            return data.status === 'dry_run'
              ? t.admin.emailTestDryRun
              : t.admin.emailTestSent.replace('{to}', data.to);
          })
        }
      >
        {t.admin.emailTest}
      </button>
      {!configured && <p className="field__help">{t.admin.emailTestNeedsSetup}</p>}

      {note && <p className="note note--inline">{note}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
