import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EmailPreview } from './EmailPreview';
import { EmailSetup } from './EmailSetup';
import { TextField } from './fields';
import { useI18n } from '../i18n/context';
import { emailError } from '../lib/errors';
import {
  getPlatformEmailConfiguration,
  platformEmailDomain,
  sendPlatformTestEmail,
  setPlatformEmailSettings,
  setPlatformEmailTemplate,
  type Domain,
  type EmailDeliveryReadiness,
} from '../lib/roles';
import { useLatest } from '../lib/useLatest';
import {
  EMPTY_SETTINGS,
  senderMismatch,
  validateSettings,
  type EmailSettings,
} from '@shared/emailSettings';
import type { TemplateOverrides } from '@shared/emailTemplates';
import { Result } from '../screens/admin/Result';

export function PlatformEmailDefaults({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [settings, setSettings] = useState<EmailSettings>(EMPTY_SETTINGS);
  const [storedSettings, setStoredSettings] = useState<EmailSettings>(EMPTY_SETTINGS);
  const [keyHint, setKeyHint] = useState('');
  const [domainId, setDomainId] = useState('');
  const [domain, setDomain] = useState('');
  const [stagedDomainId, setStagedDomainId] = useState('');
  const [stagedDomain, setStagedDomain] = useState('');
  const [candidateDomain, setCandidateDomain] = useState<Domain | null>(null);
  const [delivery, setDelivery] = useState<EmailDeliveryReadiness | null>(null);
  const [templates, setTemplates] = useState<TemplateOverrides>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [domainNote, setDomainNote] = useState('');
  const [domainError, setDomainError] = useState('');
  const [setupDirty, setSetupDirty] = useState(false);
  const [wordingDirty, setWordingDirty] = useState(false);
  const editing = useRef(false);
  const generation = useRef(0);
  const senderDirty =
    settings.from !== storedSettings.from || settings.replyTo !== storedSettings.replyTo;
  const dirty = senderDirty || setupDirty || wordingDirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const { data } = await getPlatformEmailConfiguration({});
      if (generation.current !== request) return;
      if (!editing.current) {
        setSettings(data.settings);
        setStoredSettings(data.settings);
      }
      setKeyHint(data.keyHint);
      setDomainId(data.domainId);
      setDomain(data.domain);
      setStagedDomainId(data.stagedDomainId ?? '');
      setStagedDomain(data.stagedDomain ?? '');
      const candidateId = data.stagedDomainId || data.domainId;
      setCandidateDomain((current) => (current?.id === candidateId ? current : null));
      setDelivery(data.delivery);
      setTemplates(data.templates ?? {});
      setReady(true);
      setError('');
    } catch (caught) {
      if (generation.current !== request) return;
      setReady(true);
      setError(emailError(caught, tRef.current));
    }
  }, [tRef]);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  const domainActions = useMemo(
    () => ({
      async list(): Promise<Domain[]> {
        const { data } = await platformEmailDomain({ action: 'list' });
        const domains = data.domains ?? [];
        setCandidateDomain(domains[0] ?? null);
        return domains;
      },
      async add(name: string): Promise<void> {
        const { data } = await platformEmailDomain({ action: 'add', domain: name });
        setCandidateDomain(data.domain ?? null);
      },
      async verify(): Promise<Domain | undefined> {
        const { data } = await platformEmailDomain({ action: 'verify' });
        setCandidateDomain(data.domain ?? null);
        return data.domain;
      },
    }),
    [],
  );

  async function saveSender() {
    setNote('');
    setError('');
    const problem = validateSettings(settings);
    if (problem) {
      setError(t.admin.emailSender[problem.problem]);
      return;
    }
    const mismatch = senderMismatch(settings.from, domain);
    if (mismatch) {
      setError(
        t.admin.emailDomainMismatch.replace('{sender}', mismatch).replace('{verified}', domain),
      );
      return;
    }
    setBusy(true);
    try {
      await setPlatformEmailSettings({ from: settings.from, replyTo: settings.replyTo });
      editing.current = false;
      setStoredSettings(settings);
      setNote(t.platformAdmin.emailDefaultsSaved);
      await refresh();
    } catch (caught) {
      setError(emailError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function activateStagedDomain() {
    if (
      !stagedDomainId ||
      !stagedDomain ||
      candidateDomain?.id !== stagedDomainId ||
      candidateDomain.status !== 'verified'
    ) {
      return;
    }
    setDomainNote('');
    setDomainError('');
    setBusy(true);
    const senderWillClear = !settings.from || Boolean(senderMismatch(settings.from, stagedDomain));
    try {
      await platformEmailDomain({ action: 'activate' });
      editing.current = false;
      setDomainNote(
        senderWillClear
          ? t.platformAdmin.emailDefaultsDomainActivatedSenderCleared
          : t.platformAdmin.emailDefaultsDomainActivated,
      );
      await refresh();
    } catch (caught) {
      setDomainError(emailError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <p className="muted" role="status">{t.app.loading}</p>;
  }

  if (!delivery && error) {
    return (
      <section className="section">
        <Result ok="" error={t.platformAdmin.emailDefaultsLoadError} />
        <button type="button" className="btn" onClick={() => void refresh()}>
          {t.platformAdmin.retry}
        </button>
      </section>
    );
  }

  const configured = delivery?.ready === true;
  const keyConfigured = Boolean(
    delivery &&
      !delivery.problems.some((problem) =>
        ['missing_key', 'invalid_key', 'setup_unavailable'].includes(problem),
      ),
  );
  const mismatch = senderMismatch(settings.from, domain);
  const stagedVerified =
    Boolean(stagedDomainId) &&
    candidateDomain?.id === stagedDomainId &&
    candidateDomain.name.toLowerCase() === stagedDomain.toLowerCase() &&
    candidateDomain.status === 'verified';
  return (
    <div className="platform-email-defaults">
      <header className="platform-email-defaults__header">
        <h2 id="platform-email-defaults-title">{t.platformAdmin.emailDefaultsTitle}</h2>
        <p>{t.platformAdmin.emailDefaultsIntro}</p>
      </header>

      <section
        className={`email-delivery-status${configured ? ' email-delivery-status--ready' : ''}`}
        aria-labelledby="platform-email-delivery-title"
      >
        <div className="email-delivery-status__mark" aria-hidden="true">
          {configured ? '✓' : '!'}
        </div>
        <div className="email-delivery-status__copy">
          <p className="email-delivery-status__eyebrow">
            {t.platformAdmin.emailDefaultsProviderTitle}
          </p>
          <h3 id="platform-email-delivery-title">
            {configured
              ? t.platformAdmin.emailDefaultsReady
              : t.platformAdmin.emailDefaultsBlocked}
          </h3>
          <p>
            {configured
              ? t.platformAdmin.emailDefaultsReadyHelp
              : t.platformAdmin.emailDefaultsBlockedHelp}
          </p>
          {!configured && delivery && (
            <ul className="email-delivery-status__problems">
              {delivery.problems.map((problem) => (
                <li key={problem}>{t.admin.emailDeliveryProblems[problem] ?? problem}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="section platform-email-defaults__section">
        <h3>{t.platformAdmin.emailDefaultsProviderTitle}</h3>
        <p className="section__help">{t.platformAdmin.emailDefaultsProviderHelp}</p>
        <div className="email-source__choices platform-email-defaults__domains">
          <article className="email-source__choice email-source__choice--active">
            <div>
              <h3>{t.platformAdmin.emailDefaultsActiveDomainTitle}</h3>
              <p>{t.platformAdmin.emailDefaultsActiveDomainHelp}</p>
            </div>
            <strong className="email-domain__state">
              {domain || t.platformAdmin.emailDefaultsNoActiveDomain}
            </strong>
          </article>
          <article className="email-source__choice">
            <div>
              <h3>{t.platformAdmin.emailDefaultsStagedDomainTitle}</h3>
              <p>{t.platformAdmin.emailDefaultsStagedDomainHelp}</p>
            </div>
            <strong className="email-domain__state">
              {stagedDomain || t.platformAdmin.emailDefaultsNoStagedDomain}
            </strong>
            {stagedDomain && candidateDomain?.id === stagedDomainId && (
              <p className={stagedVerified ? 'note note--inline' : 'muted'}>
                {t.admin.emailDomainStatus[candidateDomain.status] ?? candidateDomain.status}
              </p>
            )}
            {stagedDomain && (
              <button
                type="button"
                className="btn"
                disabled={busy || senderDirty || setupDirty || !stagedVerified}
                onClick={() => void activateStagedDomain()}
              >
                {t.platformAdmin.emailDefaultsActivateDomain}
              </button>
            )}
            {stagedDomain && (senderDirty || setupDirty) && (
              <p className="muted">{t.platformAdmin.emailDefaultsActivateDomainDirty}</p>
            )}
          </article>
        </div>
        <Result ok={domainNote} error={domainError} />
        <EmailSetup
          cfpId="platform"
          keyHint={keyHint}
          keyConfigured={keyConfigured}
          canManageProvider
          domainId={stagedDomainId || domainId}
          domainActions={domainActions}
          onKeySet={(hint) => {
            setKeyHint(hint);
            void refresh();
          }}
          onDomainChanged={refresh}
          onDirtyChange={setSetupDirty}
        />
      </section>

      <section className="section platform-email-defaults__section">
        <h3>{t.platformAdmin.emailDefaultsSenderTitle}</h3>
        <p className="section__help">{t.platformAdmin.emailDefaultsSenderHelp}</p>
        <div className="grid grid--2">
          <TextField
            label={t.admin.emailFrom}
            required
            value={settings.from}
            onChange={(from) => {
              editing.current = true;
              setSettings((current) => ({ ...current, from }));
            }}
            disabled={busy}
          />
          <TextField
            label={t.admin.emailReplyTo}
            value={settings.replyTo}
            onChange={(replyTo) => {
              editing.current = true;
              setSettings((current) => ({ ...current, replyTo }));
            }}
            disabled={busy}
          />
        </div>
        {mismatch && (
          <p className="note note--inline" role="status">
            {t.admin.emailDomainMismatch.replace('{sender}', mismatch).replace('{verified}', domain)}
          </p>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy || !senderDirty}
          onClick={() => void saveSender()}
        >
          {t.admin.emailSaveSender}
        </button>
        <Result ok={note} error={error} />
      </section>

      <section className="section platform-email-defaults__section">
        <h3>{t.platformAdmin.emailDefaultsWordingTitle}</h3>
        <p className="section__help">{t.platformAdmin.emailDefaultsWordingHelp}</p>
        <EmailPreview
          cfpId="email-preview-example"
          cfpName={t.platformAdmin.emailDefaultsSampleEvent}
          configured={configured}
          templates={templates}
          ownedTemplates={templates}
          actions={{
            save: async (input) => {
              await setPlatformEmailTemplate(input);
            },
            reset: async (input) => {
              await setPlatformEmailTemplate({ ...input, reset: true });
            },
            test: async (input) => (await sendPlatformTestEmail(input)).data,
          }}
          onSaved={refresh}
          onDirtyChange={setWordingDirty}
        />
      </section>
    </div>
  );
}
