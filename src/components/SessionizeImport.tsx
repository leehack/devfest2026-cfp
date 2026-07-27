import { useState } from 'react';
import type { SessionizeProfile, SessionizeSession } from '@shared/sessionize';
import { useI18n } from '../i18n';
import {
  applySessionizeProfile,
  applySessionizeSession,
  type FormState,
  type OverLimit,
} from '../lib/formState';
import { importSessionizeProfile } from '../lib/proposals';

interface SessionizeImportProps {
  form: FormState;
  onApply: (patch: Partial<FormState>) => void;
  disabled?: boolean;
}

/**
 * Prefills the speaker section — and optionally the talk — from a public
 * Sessionize profile.
 *
 * A profile page carries every talk with its full abstract, so a pasted talk
 * link is resolved back to the profile rather than fetched directly: one
 * request, and it returns the bio too, which a session page does not have.
 *
 * Everything it does is reported in words: what was filled, what was left
 * alone, what could not be read, and what will not pass validation. Sessionize
 * can change their markup at any time, and an import that silently fills
 * nothing looks identical to one that had nothing to fill.
 */
export function SessionizeImport({ form, onApply, disabled }: SessionizeImportProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionizeSession[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  /** What the last applied talk wrote, so switching talks can replace it. */
  const [applied, setApplied] = useState<{ title: string; abstract: string } | undefined>();

  const describeLimits = (limits: OverLimit[]) =>
    limits.map((l) => {
      const name = t.import.fieldNames[l.field] ?? l.field;
      return l.length > l.max
        ? t.import.tooLong(name, l.length, l.max)
        : t.import.tooShort(name, l.length, l.min);
    });

  function applyProfile(profile: SessionizeProfile, missingSession: boolean): string[] {
    const { patch, filled, skipped, overLimit } = applySessionizeProfile(form, profile);
    if (Object.keys(patch).length > 0) onApply(patch);

    const lines: string[] = [];
    lines.push(filled.length > 0 ? t.import.filled(filled.join(', ')) : t.import.nothing);
    if (skipped.length > 0) lines.push(t.import.skipped(skipped.join(', ')));
    if (profile.warnings.length > 0) lines.push(t.import.partial(profile.warnings.join(', ')));
    lines.push(...describeLimits(overLimit));
    if (missingSession) lines.push(t.import.sessionMissing);
    return lines;
  }

  /** Applies a talk and returns the lines describing it, rather than setting them. */
  function chooseSession(session: SessionizeSession): string[] {
    const { patch, filled, skipped, overLimit } = applySessionizeSession(form, session, applied);
    if (Object.keys(patch).length > 0) onApply(patch);
    setChosen(session.id);
    // Only remember what we actually wrote — if the speaker's own title was
    // left alone, we must not later claim the right to overwrite it.
    setApplied({
      title: patch.title ?? '',
      abstract: patch.abstract ?? '',
    });

    const lines = [t.import.sessionApplied(session.title)];
    if (filled.length > 0) lines.push(t.import.filled(filled.join(', ')));
    if (skipped.length > 0) lines.push(t.import.skipped(skipped.join(', ')));
    lines.push(...describeLimits(overLimit));
    return lines;
  }

  async function run() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    setSessions([]);
    setChosen(null);
    setApplied(undefined);

    try {
      const { data } = await importSessionizeProfile({ url: url.trim() });
      const lines = applyProfile(data.profile, Boolean(data.requestedSessionMissing));
      setSessions(data.profile.sessions ?? []);

      // A pasted talk link says which one they meant, so do not make them pick
      // it again out of a list of seven. Its report is appended rather than
      // substituted — the speaker still needs to know their bio and links were
      // filled in as well.
      const preselected = data.profile.sessions?.find((s) => s.id === data.preselectSessionId);
      setReport(preselected ? [...lines, ...chooseSession(preselected)] : lines);
    } catch (e: any) {
      setError(e?.message ?? t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field import">
      <span className="field__label">{t.import.label}</span>
      <p className="field__help">{t.import.help}</p>

      <div className="import__row">
        <input
          className="field__input"
          value={url}
          placeholder={t.import.placeholder}
          disabled={disabled || busy}
          aria-label={t.import.label}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            // Enter inside the form would otherwise submit the whole proposal.
            if (e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
        />
        <button
          type="button"
          className="btn btn--ghost"
          disabled={disabled || busy || !url.trim()}
          onClick={() => void run()}
        >
          {busy ? t.import.importing : t.import.action}
        </button>
      </div>

      {report && (
        <div className="import__report" role="status">
          {report.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}

      {sessions.length > 0 && (
        <div className="import__sessions">
          <p className="field__help">{t.import.sessionsFound(sessions.length)}</p>
          <ul>
            {sessions.map((session) => (
              <li key={session.id} className={session.id === chosen ? 'is-chosen' : undefined}>
                <div className="import__session-title">{session.title}</div>
                <div className="import__session-meta">
                  {session.abstract
                    ? `${session.abstract.length} characters`
                    : t.import.noAbstract}
                </div>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={disabled || session.id === chosen}
                  onClick={() => setReport(chooseSession(session))}
                >
                  {t.import.useThis}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
